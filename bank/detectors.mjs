/**
 * CBOB Bank alarm — DETECTORS.
 *
 * Pure functions over a normalised instruction list, deliberately separated from
 * the fetching so they can be driven with synthetic input and proven to fire in
 * BOTH directions. A detector that has only ever said "quiet" is untested, and
 * this pipeline is where a real share of the vault guarantee now lives: the
 * on-chain programs cannot enumerate what a PDA owns, so completeness is this
 * file's job.
 *
 * WHAT EACH ONE IS BLIND TO IS STATED WITH IT. A clean report from here means
 * "none of these four things happened", never "the vaults are fine".
 */
export const CORE_ID = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
export const ATA_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
export const TOKEN_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const TOKEN22_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
export const IX_BURN_V1 = 12
/** 21,000 sats at cbBTC's 8 decimals. Activation is a READ, not a rule. */
export const ACTIVATION_SATS = 21000n

const S = { CRITICAL: 'CRITICAL', HIGH: 'HIGH', INFO: 'INFO' }
export const DEFAULT_PUBKEY = '11111111111111111111111111111111'
/** The fixed-forever wiring Gary ruled (DESIGN-v6), pinned here so the alarm and
 *  scripts/check-launch-params.mjs judge launch against the same constants, which
 *  are NOT read from launch/mainnet-init.json (round 22, A7). */
export const CBBTC_MINT = 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'
export const CBOBTC_SQUADS = 'bc92ZsHGUjkB5KBKWgHTurFuLnTrQ3oJyKCqEPrpUw1'
export const GUARDIAN_AT_LAUNCH = 'Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb'
export const RESERVE_MINTS = [CBBTC_MINT, '8c71AvjQeKKeWRe8jtTGG1bJ2WiYXQdbjqFbUfhHgSVk', 'Gq7eEnTR1YDzNgs7qVRMThY8xt9CDZknxixKJSxQpump']
export const POB_ROOT = '522ac90e5e6b9f1f3f262056c66b3bf5c19eebe5c4070cc607896f5b87d0809c'

/**
 * ANY approve against a vault-owned token account.
 *
 * Why it matters: a delegate approved during a legitimate thaw SURVIVES the
 * re-seal, and the Token program will honour it later with no Execute and
 * and no thaw — draining a vault that still reads as sealed and full. The seal
 * program refuses this on the canonical reserve ATAs; a NON-ATA token account is
 * invisible to it. That gap is exactly this detector.
 *
 * BLIND TO: an approve inside a program whose CPI we cannot parse, and any
 * approve on an account whose owner we have not resolved to a vault PDA.
 */
export function detectApprovals(ixs, pdaSet, ataOwner = {}) {
  const out = []
  for (const ix of ixs) {
    if (ix.program !== TOKEN_ID && ix.program !== TOKEN22_ID) continue
    const t = ix.parsed?.type
    if (t !== 'approve' && t !== 'approveChecked') continue
    const info = ix.parsed?.info || {}
    // `info.owner` is what the RPC's jsonParsed output gives us, and the whole
    // detector hangs off it — so it gets a SECOND way to reach the same answer.
    // If a parser version ever drops the field, `pdaSet.has(undefined)` is false
    // and this becomes a no-op that keeps passing its own selftest. The fallback
    // resolves the owner from the token ACCOUNT instead, using the map of vault
    // ATAs the caller already had to build.
    const owner = pdaSet.has(info.owner) ? info.owner : ataOwner[info.source]
    if (!pdaSet.has(owner)) continue
    out.push({ kind: 'approve', severity: S.CRITICAL, pda: owner,
      detail: `delegate ${info.delegate} approved on ${info.source} by vault PDA ${owner}`
        + (info.owner === owner ? '' : ' (owner resolved from the account, not from the parse)') })
  }
  return out
}

/**
 * ANY token account being created for a vault PDA.
 *
 * A canonical reserve ATA is expected — that is how a vault gets activated. A
 * token account at ANY OTHER address is the on-chain blind spot in person: the
 * burn program can only check accounts the caller declares, so an undeclared
 * one is invisible and its contents are destroyed with the vault.
 *
 * BLIND TO: an account created before this pipeline started watching. The
 * reconcile pass, not this detector, is what covers that.
 */
export function detectPdaTokenAccounts(ixs, pdaSet, expectedAtas) {
  const out = []
  for (const ix of ixs) {
    let wallet = null, account = null
    if (ix.program === ATA_ID) {
      const i = ix.parsed?.info || {}
      wallet = i.wallet; account = i.account
    } else if ((ix.program === TOKEN_ID || ix.program === TOKEN22_ID) &&
               /^initializeAccount/.test(ix.parsed?.type || '')) {
      const i = ix.parsed?.info || {}
      wallet = i.owner; account = i.account
    }
    if (!wallet || !pdaSet.has(wallet)) continue
    const expected = expectedAtas.has(account)
    out.push({
      kind: expected ? 'reserve_ata_created' : 'non_ata_token_account',
      severity: expected ? S.INFO : S.CRITICAL,
      pda: wallet,
      detail: expected
        ? `canonical reserve ATA ${account} created for vault PDA ${wallet}`
        : `NON-CANONICAL token account ${account} created for vault PDA ${wallet} — invisible to burn_vault unless declared`,
    })
  }
  return out
}

/**
 * A burn of a vault seen INSIDE A TRANSACTION WE ALREADY SCAN.
 *
 * Core's BurnV1 is available to the owner directly and CANNOT be prevented while
 * the vault stays freely transferable (measured: PermanentFreezeDelegate blocks
 * transfer not burn; FreezeDelegate blocks both and kills resale). A bare burn
 * orphans the contents permanently, so every burn is worth a human look.
 *
 * BLIND TO — and this is the important part — A BARE Core BurnV1 IN A
 * TRANSACTION THAT TOUCHES NONE OF OUR FOUR PROGRAMS. It used to be fed from the
 * Core program's own signature tail, which cannot work: 200 signatures is 117
 * SECONDS of mainnet Core activity (MEASURED 2026-08-22) against a 30-minute
 * pass, so the window it saw was under 1% of the interval and none of it was
 * ours. `detectVaultSetChange` is what actually covers a bare burn now, by
 * reconciling the whole collection against the previous pass. This detector is
 * kept because it names the ROUTE (which transaction, which program) once a burn
 * is inside a transaction we do scan, and `detectVaultSetChange` cannot.
 */
/**
 * Flatten a jsonParsed transaction into the shape the detectors expect. Top-level
 * instructions carry their `index`; inner ones carry `parent`, the index of the
 * top-level instruction that invoked them (round 22, A1: without it a CPI cannot
 * be told from a top-level call). Pure, so the selftest feeds it real shapes.
 */
export function normaliseTx(tx) {
  const keys = tx.transaction.message.accountKeys.map(k => (k.pubkey || k).toString())
  const one = ix => ({
    program: (ix.programId || keys[ix.programIdIndex]).toString(),
    parsed: ix.parsed,
    accounts: (ix.accounts || []).map(a => (typeof a === 'number' ? keys[a] : a.toString())),
    dataBytes: ix.data ? [...Buffer.from(bs58decode(ix.data))] : undefined,
  })
  const top = (tx.transaction.message.instructions || []).map((ix, index) => ({ ...one(ix), index }))
  const inner = (tx.meta?.innerInstructions || []).flatMap(g => g.instructions.map(ix => ({ ...one(ix), parent: g.index })))
  return [...top, ...inner]
}
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function bs58decode(s) {
  let n = 0n
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) return Buffer.alloc(0); n = n * 58n + BigInt(i) }
  const bytes = []; while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n }
  for (const c of s) { if (c === '1') bytes.unshift(0); else break }
  return Buffer.from(bytes)
}

export function detectBurns(ixs, assetSet, burnProgramId, burnVaultDiscriminator = null) {
  const out = []
  // ROUND 22 (A1): BURN's OWN BurnV1 IS NOT A BARE BURN. `burn_vault` destroys the
  // vault by CPI into Core's BurnV1, and the alarm flattens inner instructions in
  // beside the top-level ones, so every honest redemption paged a CRITICAL
  // `bare_core_burn` (measured, and it had been so since v5: no test ever fed
  // this an inner instruction). A Core BurnV1 is BURN's own exactly when it is an
  // inner instruction of a top-level `burn_vault` naming the SAME asset. Anything
  // else (top level, under another program, another asset) stays CRITICAL.
  const burnVaultAt = new Map()
  for (const ix of ixs) {
    if (ix.parent !== undefined || ix.program !== burnProgramId) continue
    if (burnVaultDiscriminator && !(ix.dataBytes && burnVaultDiscriminator.every((b, i) => ix.dataBytes[i] === b))) continue
    burnVaultAt.set(ix.index, ix.accounts?.[0])
  }
  for (const ix of ixs) {
    if (ix.program === burnProgramId) {
      // ONLY `burn_vault`. This used to fire on ANY instruction to the BURN
      // program, so `initialize` and `update_config` produced a HIGH "burn" —
      // and a detector that cries wolf on routine admin work is one people learn
      // to scroll past, which costs more than the finding is worth.
      if (burnVaultDiscriminator && !(ix.dataBytes && burnVaultDiscriminator.every((b, i) => ix.dataBytes[i] === b))) continue
      // INFO, NOT HIGH — CHANGED IN ROUND 13, AND THE REASON MATTERS.
      //
      // Under v5 `burn_vault` IS the redemption. Every honest customer exit runs
      // it, and the chain guarantees it was paired with `open_for_redemption`
      // for the same asset and owner — an unpaired burn_vault cannot be
      // constructed. So a HIGH here fires on the normal path and carries no
      // information, which is exactly what this file's own comment two lines up
      // says makes a detector useless.
      //
      // The severity that matters is `vault_burned` / `vault_left_index` from
      // `detectVaultSetChange`, and `correlateBurns` below uses these findings to
      // tell those two apart. Keeping this HIGH would bury the one detector that
      // sees a bare Core BurnV1 under one CRITICAL and two HIGHs per redemption
      // (two, because the transaction touches SEAL and BURN and is therefore
      // scanned in both programs' signature walks).
      // ⚠️ THIS FINDING IS THE KEY `correlateBurns` DOWNGRADES ON, AND IT IS
      // CALLER-SUPPLIED — `ix.accounts[0]` is whatever the transaction named.
      // Round 15 carried it as a possible laundering route: put a `burn_vault`
      // naming vault A in a transaction while bare-burning A, and A's CRITICAL
      // becomes INFO.
      //
      // MEASURED AND REFUTED, and the reason lives in ANOTHER FILE: `alarm.mjs`
      // skips failed transactions (`if (s.err) continue`) before it decodes a
      // single instruction. A `burn_vault` that SUCCEEDS burned that exact asset,
      // needed the owner's signature, and was cross-checked on chain against our
      // collection — so the key cannot be borrowed.
      //
      // THAT GUARD IS THEREFORE LOAD-BEARING FOR A DETECTOR IN A DIFFERENT FILE,
      // which is exactly the kind of dependency that gets removed by someone
      // making a reasonable change ("let's also see ATTEMPTED attacks"). It is
      // asserted in bank/selftest.mjs against alarm.mjs's source, so removing it
      // fails the build instead of quietly opening the laundering route.
      out.push({ kind: 'burn_via_program', severity: S.INFO, asset: ix.accounts?.[0] ?? null,
        detail: `burn_vault invoked on ${ix.accounts?.[0] ?? 'unknown'} — the normal redemption path` })
      continue
    }
    if (ix.program !== CORE_ID) continue
    if (ix.dataBytes?.[0] !== IX_BURN_V1) continue
    const asset = ix.accounts?.[0]
    if (!assetSet.has(asset)) continue
    if (ix.parent !== undefined && burnVaultAt.get(ix.parent) === asset) continue
    out.push({ kind: 'bare_core_burn', severity: S.CRITICAL, asset,
      detail: `BARE Core BurnV1 on vault ${asset} — did NOT go through burn_vault, so nothing checked the contents` })
  }
  return out
}

/**
 * THE BURN DETECTOR THAT ACTUALLY WORKS: reconcile the whole collection.
 *
 * DAS indexes every asset in the collection and flags the burnt ones, so a diff
 * against the previous pass is COMPLETE BY CONSTRUCTION — it does not depend on
 * catching a transaction in a tail, which for a bare Core burn is impossible
 * (see `detectBurns`). It also catches a burn of a vault that was never
 * activated, which the activation detector deliberately ignores.
 *
 * THE FALSE-ALARM GUARD IS LOAD-BEARING. A partial DAS answer would otherwise
 * read as "hundreds of vaults burned at once", and a detector that cries wolf at
 * that volume is one nobody reads. So a drop larger than `maxDropRatio` of the
 * known set is reported as ONE finding about the INDEX, and the caller is told
 * (`trustCurrent: false`) not to overwrite its stored vault set with a list it
 * has just been told to disbelieve.
 *
 * BLIND TO: a vault burned and re-minted between two passes (the ids differ, so
 * it reads as one burn and one new vault, which is the truth); and anything at
 * all if DAS itself is wrong in a way that keeps the counts plausible.
 */
export function detectVaultSetChange(prevLive, current, opts = {}) {
  const out = []
  if (!prevLive || !prevLive.length) return { findings: out, trustCurrent: true }
  const live = new Set(current.live || [])
  const burnt = new Set(current.burnt || [])
  const gone = prevLive.filter(a => !live.has(a))
  const ratio = opts.maxDropRatio ?? 0.1
  const allowed = Math.max(3, Math.floor(prevLive.length * ratio))
  if (gone.length > allowed) {
    out.push({ kind: 'vault_index_shrank', severity: S.CRITICAL,
      detail: `${gone.length} of ${prevLive.length} vaults disappeared from the collection index in one pass (more than the ${allowed} a real burn run could plausibly be). NOT treated as ${gone.length} burns: the index is more likely wrong than the chain. The stored vault set was NOT updated, so the next good pass compares against real history.` })
    return { findings: out, trustCurrent: false }
  }
  for (const a of gone) {
    out.push(burnt.has(a)
      ? { kind: 'vault_burned', severity: S.CRITICAL, asset: a,
          detail: `vault ${a} is BURNED. Anything in its asset-signer PDA that burn_vault did not check is orphaned permanently.` }
      : { kind: 'vault_left_index', severity: S.CRITICAL, asset: a,
          detail: `vault ${a} is no longer in the collection index and is not flagged burnt — it was burned, moved out of the collection, or the index is wrong. All three need a human.` })
  }
  return { findings: out, trustCurrent: true }
}

/**
 * THE COLLECTION KEYS, DECLARED ONCE.
 *
 * ROUND 11, found by four of seven auditors. `detectStandingRisks` compares
 * these four for `collections_disagree` — a CRITICAL — and not one of them was
 * in `WATCH` or in `WATCHED_KEYS`, so round 10's claim that the mechanical
 * check "asserts against everything the standing checks read" was false in the
 * very mechanism built to close that class. The failure is the exact
 * `mint.pending_bank` shape: drop one program's `collection` read and the
 * `.filter(([, v]) => v)` below silently compares three values, `distinct.size`
 * stays 1, and a mismatch that sells unredeemable vaults reads as calm.
 *
 * An assertion would have caught it. A SHARED ARRAY makes it unnecessary: the
 * check and the watch list are now the same list, so they cannot drift apart.
 */
export const COLLECTION_KEYS = ['seal.collection', 'mint.collection', 'burn.collection', 'gov.collection']

/**
 * WHAT A CHANGE IN v6 MEANS. Most of v6's config is written ONCE by `initialize`
 * and no instruction can write it again: the 85/15 split, both destinations, the
 * supply cap, the charter window, the Proof of Burn set, the payout period, the
 * redemption window and the whole GOV tally rule. For those fields ANY change is
 * not "a rotation somebody armed" — there is no such instruction — it is the
 * deployed program doing something its source says it cannot, and that is
 * CRITICAL on its face.
 *
 * The fields a VOTE can still reach (round terms, the guardian, the swap
 * operator via a 7-day notice, the sweep bounds, tighter only) and the fields the
 * GUARDIAN can reach (the two stops, on only) are watched so a holder-visible
 * act is never silent. Supply growth (`minted_total`) is a STATUS, not an alert:
 * during a sale it moves every few seconds, and an alert channel whose steady
 * state is green receipts is the one people learn to scroll past.
 */
const WATCH = [
    // ── PERMANENT AT INITIALIZE: any change means the program is not the source ──
    ...COLLECTION_KEYS.map(k => [k, S.CRITICAL, 'WHICH COLLECTION THIS PROGRAM SERVICES — fixed forever']),
    ['seal.reserve_mints', S.CRITICAL, 'the reserve set every emptiness proof checks — fixed forever'],
    ['mint.governance', S.CRITICAL, 'the GOV PDA — fixed forever'],
    ['mint.pool_ata', S.CRITICAL, "the holders' 85% — fixed forever"],
    ['mint.bank_treasury', S.CRITICAL, 'the 15% destination — fixed forever'],
    ['mint.split_bps', S.CRITICAL, 'THE 85/15 RULE ITSELF — fixed forever'],
    ['mint.max_supply', S.CRITICAL, 'the lifetime supply promise — fixed forever'],
    ['mint.payment_mint', S.CRITICAL, 'what rounds are paid in and the pool holds — fixed forever'],
    ['mint.level_caps', S.CRITICAL, 'the level census — fixed forever'],
    ['mint.pob_collection', S.CRITICAL, 'where the Proof of Burn set lives — fixed forever'],
    ['mint.pob_root', S.CRITICAL, 'WHICH 240 Proof of Burns may claim — fixed forever'],
    ['mint.charter_opens_at', S.CRITICAL, 'the charter window — fixed forever'],
    ['mint.charter_closes_at', S.CRITICAL, 'the charter window, which can never reopen — fixed forever'],
    ['mint.monthly_secs', S.CRITICAL, 'the free distribution period — fixed forever'],
    ['burn.redeem_window_secs', S.CRITICAL, 'the 2.1%-per-window rate limit window — fixed forever'],
    // stage 3c: the key-change notice and the bounds no vote may tighten past
    ['mint.notice_secs', S.CRITICAL, 'the notice before a voted guardian or swap operator lands — fixed forever'],
    ['mint.sweep_floor_lamports', S.CRITICAL, 'the lowest per-sweep cap a vote may set — fixed forever'],
    ['mint.cooldown_ceiling_secs', S.CRITICAL, 'the longest sweep cooldown a vote may set — fixed forever'],
    ['mint.reserve_ceiling_lamports', S.CRITICAL, 'the largest SOL reserve a vote may set — fixed forever'],
    ['gov.quorum_bps', S.CRITICAL, 'the bar a vote must clear — fixed forever'],
    ['gov.threshold_bps', S.CRITICAL, 'the YES share a vote must clear — fixed forever'],
    ['gov.min_voting_secs', S.CRITICAL, 'how long every vote stays open — fixed forever'],
    ['seal.version', S.HIGH, 'the layout every offset read depends on'],
    ['mint.version', S.HIGH, 'ditto'],
    ['burn.version', S.HIGH, 'ditto'],
    ['gov.version', S.HIGH, 'ditto'],
    // ── REACHABLE BY A VOTE (or its 7-day notice) ──
    ['mint.guardian', S.CRITICAL, 'who may pull the emergency brake — a vote replaced it'],
    ['mint.swap_operator', S.CRITICAL, 'the only address SOL may be swept to'],
    ['mint.pending_swap_operator', S.CRITICAL, 'A SWAP-OPERATOR REPLACEMENT IS ARMED (7-day notice)'],
    ['mint.pending_swap_operator_at', S.CRITICAL, 'when that replacement was armed'],
    ['mint.pending_guardian', S.CRITICAL, 'A GUARDIAN REPLACEMENT IS ARMED (7-day notice)'],
    ['mint.pending_guardian_set', S.CRITICAL, 'whether a guardian change (or retirement) is pending'],
    ['mint.pending_guardian_at', S.CRITICAL, 'when that guardian change was armed'],
    ['mint.sol_reserve_lamports', S.HIGH, 'what the revenue address keeps for fees (vote, tighter only)'],
    ['mint.max_sweep_lamports', S.HIGH, 'the on-chain ceiling on one sweep (vote, tighter only)'],
    ['mint.sweep_cooldown_secs', S.HIGH, 'the cooldown that makes the ceiling a rate (vote, tighter only)'],
    ['mint.round_id', S.HIGH, 'a new sale round has been ratified'],
    ['mint.price', S.HIGH, 'THE PRICE STRANGERS PAY'],
    ['mint.cap', S.HIGH, "the round's cap"],
    ['mint.opens_at', S.HIGH, 'when the round opens'],
    ['mint.closes_at', S.HIGH, 'when it closes'],
    ['gov.proposal_count', S.HIGH, 'A NEW PROPOSAL HAS BEEN OPENED'],
    ['gov.last_round_id', S.HIGH, 'a round proposal has executed'],
    ['gov.last_guardian_id', S.HIGH, 'a guardian change has executed'],
    ['gov.last_arm_id', S.HIGH, 'a swap-operator arm has executed'],
    // ── THE GUARDIAN'S TWO ONE-WAY STOPS (a vote is the only way back) ──
    // The two brakes are NOT here: `detectBrakeTransitions` pages the pull and
    // the release once each, URGENT, and the standing check keeps an ON brake
    // visible at INFO. Listing them here too would page every transition twice.
    // ── THE CODE ITSELF. v6 is made IMMUTABLE at launch; until then, and for
    //    Core for ever, a byte change is the one thing no config watch can see. ──
    ['prog.seal.upgrade_authority', S.CRITICAL, 'can replace the SEAL program'],
    ['prog.mint.upgrade_authority', S.CRITICAL, 'can replace the MINT program'],
    ['prog.burn.upgrade_authority', S.CRITICAL, 'can replace the BURN program'],
    ['prog.gov.upgrade_authority', S.CRITICAL, 'can replace the GOV program'],
    ['prog.seal.hash', S.CRITICAL, 'THE DEPLOYED SEAL BYTES CHANGED'],
    ['prog.mint.hash', S.CRITICAL, 'THE DEPLOYED MINT BYTES CHANGED'],
    ['prog.burn.hash', S.CRITICAL, 'THE DEPLOYED BURN BYTES CHANGED'],
    ['prog.gov.hash', S.CRITICAL, 'THE DEPLOYED GOV BYTES CHANGED'],
    ['prog.core.upgrade_authority', S.CRITICAL, 'can replace METAPLEX CORE, which every vault rests on'],
    ['prog.core.hash', S.CRITICAL, 'THE DEPLOYED METAPLEX CORE BYTES CHANGED — every seal, thaw, sweep and burn is a CPI into it'],
    // The 10% royalty lives in a collection plugin whose authority is None; the
    // collection's other bytes move with every mint (num_minted), so the hash is
    // of the PLUGIN REGION only — see alarm.mjs `collectionPluginHash`.
    ['collection.plugins_hash', S.CRITICAL, "the collection's plugins (the fixed 10% royalty) changed"],
    // RED-TEAM 2, FINDING 1: the Proof of Burn collection (Giraffish Moments) is
    // NOT ours — its update authority is the Gary Club inventory hot wallet. A
    // plugin added there (an Oracle burn-check, or a benign Moments hook) can make
    // every charter claim's PoB burn fail, inside a window that can never reopen.
    // Detection only; the cure is custody of that key for the window.
    ['pob_collection.plugins_hash', S.CRITICAL, 'THE PROOF OF BURN COLLECTION\'S PLUGINS CHANGED — a new plugin there can make every charter claim fail (RT2-1)'],
    // Gary's ruling on RT2-1 keeps that authority hot, so the alarm pages on ANY
    // authority change too: a new holder can add a hook the claim cannot pass.
    ['pob_collection.update_authority', S.CRITICAL, 'THE PROOF OF BURN COLLECTION\'S UPDATE AUTHORITY CHANGED — whoever holds it can add a plugin every charter claim must pass (RT2-1)'],
  ]

/** Every key the drift list and the standing checks depend on. `readConfigs`
 *  asserts it produces all of them: a watched key that nothing populates is a
 *  control that does not run, and it reads as calm. */
export const WATCHED_KEYS = [...new Set([
  ...COLLECTION_KEYS,
  ...WATCH.map(([k]) => k),
  'mint.total_active_weight', 'mint.acc_scaled', 'mint.owed_scaled', 'mint.last_distribute_at',
  'mint.minted_total', 'mint.bare_burns_retired', 'burn.burned_total', 'burn.rate_head', 'burn.rate_ring',
  'mint.dist_epoch', 'mint.pending_count', 'mint.pending_this_epoch',
  'mint.sales_stopped', 'mint.sweep_stopped', 'mint.guardian',
])]
/**
 * DOES THE READER PRODUCE EVERYTHING THE WATCHERS WATCH?
 *
 * Pure, so the check that closes the wired-to-nothing class is itself tested in
 * both directions — which is the whole point, given the class it closes.
 */
export function missingWatchedKeys(snap, keys = WATCHED_KEYS) {
  const produced = new Set(Object.keys(snap || {}))
  return keys.filter(k => {
    let prog = k.split('.')[0]
    // A program's keys are exempt ONLY when that program is genuinely absent
    // (round 22, A6: every prog.* key used to be exempt, so a reader that forgot
    // them read as calm).
    if (prog === 'prog') return !snap?.[`prog.${k.split('.')[1]}._missing`] && !produced.has(k)
    // The two collection hashes are read off addresses MINT's config names, so
    // they exist exactly when MINT does — and a deployed MINT whose reader forgot
    // them is a wiring fault like any other.
    if (prog === 'collection' || prog === 'pob_collection') prog = 'mint'
    if (snap?.[`${prog}._missing`]) return false     // that program is not deployed yet
    return !produced.has(k)
  })
}

export function detectConfigDrift(prev, cur) {
  const out = []
  if (!prev) return out
  const watch = WATCH

  for (const [k, severity, why] of watch) {
    const a = JSON.stringify(prev[k] ?? null), b = JSON.stringify(cur[k] ?? null)
    if (a !== b) out.push({ kind: 'config_drift', severity, detail: `${k}: ${a} -> ${b}  (${why})` })
  }
  return out
}

/**
 * THINGS THAT ARE WRONG ON THEIR FACE, every pass, independent of any change.
 *
 * `opts.production` turns on the checks that only mean something on mainnet:
 * the stage-3b open issue is that three values the suite deliberately shortens
 * (the distribution period, the redemption window, the voting period) are
 * written ONCE at `initialize` and can never be corrected after the programs are
 * locked. A short value left on mainnet is permanent, so it is reported every
 * pass until a human has looked — and it is a CRITICAL, not a note.
 */
export function detectStandingRisks(cur0, opts = {}) {
  let cur = cur0
  const out = []
  if (cur['mint.split_bps'] !== undefined && Number(cur['mint.split_bps']) !== 8500) {
    out.push({ kind: 'split_not_85_15', severity: S.CRITICAL,
      detail: `mint.split_bps is ${cur['mint.split_bps']}, not 8500. The 85/15 rule is what holders were promised, and v6 makes it permanent at initialize.` })
  }
  // THE BRAKES ARE STATUS, NOT ALERTS, ON EVERY PASS. The pull and the release
  // are paged once, as transitions (`detectBrakeTransitions`). A brake that is
  // ON stays visible at INFO so a digest never pretends sales are open.
  if (cur['mint.sales_stopped'] === true) {
    out.push({ kind: 'sales_stopped', severity: S.INFO,
      detail: 'SALES ARE STOPPED by the guardian. Only a governance vote restarts them. Redemption, activation, distribution and claims are unaffected.' })
  }
  if (cur['mint.sweep_stopped'] === true) {
    out.push({ kind: 'sweep_stopped', severity: S.INFO,
      detail: 'THE SOL SWEEP IS STOPPED by the guardian. Royalty SOL accrues in the revenue address until a vote restarts it.' })
  }
  if (cur['mint.guardian'] === DEFAULT_PUBKEY) {
    out.push({ kind: 'guardian_retired', severity: S.INFO,
      detail: 'mint.guardian is unset: nobody can pull the emergency brake. That is legal (a vote retired it), and it is worth knowing.' })
  }
  const pend = cur['mint.pending_swap_operator']
  if (pend && pend !== DEFAULT_PUBKEY) {
    out.push({ kind: 'swap_operator_armed', severity: S.CRITICAL,
      detail: `a REPLACEMENT SWAP OPERATOR ${pend} is armed (armed at unix ${cur['mint.pending_swap_operator_at']}) and anyone can apply it once the 7-day notice has passed. It becomes the only address royalty SOL can be swept to. If this was not a vote you recognise, the guardian can CANCEL it (\`cancel_swap_operator\`) and stop the sweep; only a vote can re-arm it.` })
  }
  // STAGE 3c: vaults eligible to join hold every distribution until they are
  // joined (the program's JoinWaitingFirst). Normal for the minutes between a
  // distribution and the crank's next pass; distribution_overdue pages if it lasts.
  const pc = cur['mint.pending_count'], pt = cur['mint.pending_this_epoch']
  if (pc !== undefined && pt !== undefined && BigInt(pc) - BigInt(pt) > 0n) {
    out.push({ kind: 'joins_waiting', severity: S.INFO,
      detail: `${BigInt(pc) - BigInt(pt)} vault(s) are eligible to join the payout schedule and not yet joined. No distribution can run until they are; the crank joins them, and anyone may (a free claim).` })
  }
  // STAGE 3c: a guardian change is armed too, and lands after the same notice.
  if (cur['mint.pending_guardian_set'] === true) {
    const g = cur['mint.pending_guardian']
    out.push({ kind: 'guardian_armed', severity: S.CRITICAL,
      detail: `a GUARDIAN CHANGE is armed (armed at unix ${cur['mint.pending_guardian_at']}): ${g === DEFAULT_PUBKEY ? 'the brake will be RETIRED' : `${g} will hold the brake`} once the 7-day notice has passed, and anyone can apply it. It took YES from half of all live vaults. The guardian in office keeps its brake until then; it cannot cancel its own replacement.` })
  }
  // A cap with no cooldown is not a cap. v6 lets a vote only TIGHTEN these, so a
  // value outside the working band means either the holders chose to choke the
  // revenue cycle or initialize was given the wrong number.
  const minCoolSecs = opts.minSweepCooldownSecs ?? 3600
  const cap = cur['mint.max_sweep_lamports'], cool = cur['mint.sweep_cooldown_secs']
  if (cap !== undefined && BigInt(cap) === 0n) {
    out.push({ kind: 'sweep_bound_ineffective', severity: S.CRITICAL,
      detail: 'mint.max_sweep_lamports is 0 — there is no ceiling on a single sweep.' })
  }
  if (cool !== undefined && cool !== null && Number(cool) < minCoolSecs) {
    out.push({ kind: 'sweep_cooldown_too_short', severity: S.CRITICAL,
      detail: `mint.sweep_cooldown_secs is ${cool}s, below the ${minCoolSecs}s operational minimum. The program's floor of 1 second only stops several sweeps sharing one transaction; it is not a rate limit.` })
  }
  const maxCoolSecs = opts.maxSweepCooldownSecs ?? 12 * 3600
  const minCapLamports = BigInt(opts.minSweepCapLamports ?? 5_000_000_000)
  if (cool !== undefined && cool !== null && Number(cool) > maxCoolSecs) {
    // INFO, not HIGH (round 22, A9): a vote may legally tighten this up to the
    // ceiling fixed at initialize, and a HIGH that pages forever and cannot be
    // acked is noise. The change itself is paged once, as config drift.
    out.push({ kind: 'sweep_cooldown_wedged', severity: S.INFO,
      detail: `mint.sweep_cooldown_secs is ${cool}s, longer than the ${maxCoolSecs}s a working pipeline needs. A vote can only tighten it further, never loosen it back.` })
  }
  if (cap !== undefined && BigInt(cap) > 0n && BigInt(cap) < minCapLamports) {
    out.push({ kind: 'sweep_cap_wedged', severity: S.INFO,
      detail: `mint.max_sweep_lamports is ${cap}, below the ${minCapLamports} a working pipeline needs. Revenue SOL accumulates unswept, and a vote can only lower it further.` })
  }
  // ── PERMANENT VALUES THAT MUST BE PRODUCTION VALUES ──
  if (opts.production) {
    const want = [
      ['mint.monthly_secs', 2592000, 'the free distribution period (30 days)'],
      ['burn.redeem_window_secs', 3600, 'the redemption rate-limit window (one hour)'],
      // stage 3c, and Gary's governance numbers (DESIGN-v6 §10): all written once.
      ['mint.notice_secs', 604800, 'the notice before a voted guardian or swap operator lands (7 days)'],
      // Gary 2026-10-03, "approved": the bounds no vote may tighten the swap bot past.
      ['mint.sweep_floor_lamports', 1000000000, 'the smallest per-sweep cap a vote may set (1 SOL)'],
      ['mint.cooldown_ceiling_secs', 86400, 'the longest sweep cooldown a vote may set (24 hours)'],
      ['mint.reserve_ceiling_lamports', 100000000, 'the most SOL a vote may hold back (0.1 SOL)'],
      ['gov.quorum_bps', 2100, 'the quorum (21% of live vaults)'],
      ['gov.threshold_bps', 5100, 'the YES threshold (51% of votes cast)'],
      ['gov.min_voting_secs', 259200, 'the voting period (3 days)'],
      // Round 22 (A7): the wiring is fixed forever too, so it is pinned here, not
      // only checked for shape.
      ['mint.max_supply', 2100, 'the lifetime supply (2,100 vaults)'],
      ['mint.level_caps', '945,525,315,210,105', 'the level census (945/525/315/210/105)'],
      ['mint.payment_mint', CBBTC_MINT, 'the payment mint (cbBTC)'],
      ['mint.bank_treasury', CBOBTC_SQUADS, 'the 15% destination (the CBOBTC Squads)'],
      ['seal.reserve_mints', RESERVE_MINTS.join(','), 'the three reserve assets (cbBTC, $GARY, $GIRAFFISH)'],
      ['mint.pob_root', POB_ROOT, 'the 240-address Proof of Burn root'],
      ['mint.charter_secs', 604800, 'the charter claim window (7 days)'],
    ]
    // The charter LENGTH is not a field; it is the difference of two that are.
    if (cur['mint.charter_closes_at'] !== undefined && cur['mint.charter_opens_at'] !== undefined)
      cur = { ...cur, 'mint.charter_secs': String(BigInt(cur['mint.charter_closes_at']) - BigInt(cur['mint.charter_opens_at'])) }
    for (const [k, v, what] of want) {
      if (cur[k] !== undefined && cur[k] !== null && String(cur[k]) !== String(v)) {
        out.push({ kind: 'test_value_in_production', severity: S.CRITICAL,
          detail: `${k} is ${cur[k]}, not ${v} — ${what}. It is written once at initialize and the programs are immutable, so this can never be corrected.` })
      }
    }
  }
  const colls = COLLECTION_KEYS.map(k => [k, cur[k]]).filter(([, v]) => v)
  const distinct = new Set(colls.map(([, v]) => v))
  if (colls.length > 1 && distinct.size > 1) {
    out.push({ kind: 'collections_disagree', severity: S.CRITICAL,
      detail: `the four programs do not name the same collection: ${colls.map(([k, v]) => `${k}=${v}`).join(', ')}` })
  }
  return out
}

/**
 * SOL that left the revenue address and never came back as cbBTC.
 *
 * The swap is the one trusted hop in the revenue path, so it is the one that
 * gets counted rather than assumed. A sweep with no matching return means the
 * operator key has our SOL and has not delivered — whether through a crash, a
 * failed swap, or something worse. It never resolves itself, so it escalates
 * with age rather than staying quiet.
 */
/**
 * IS THIS CYCLE STILL OPEN? One predicate, exported, used by every reader.
 *
 * There were three copies of this question and they disagreed. `String(0n)` is
 * `'0'`, which is TRUTHY, so `!c.returnedSats` reads a cycle that returned
 * NOTHING as closed. Round 6 fixed the detector and `--audit` and then wrote a
 * THIRD copy — the open-cycle guard in `revenue.mjs` — with the original bug in
 * it. Four auditors found it independently. A predicate worth getting right is
 * worth having once.
 */
export function cycleIsOpen(c) {
  const moved = BigInt(c?.sweptLamports ?? c?.intendedLamports ?? 0)
  // A cycle whose send was REJECTED (not merely unconfirmed) moved nothing and
  // is closed. Without this a `SweepTooSoon` — which the 6-hourly cron produces
  // by construction against any cooldown longer than six hours — wedges every
  // future run AND raises a CRITICAL about lamports that never left.
  if (c?.sendRejected) return false
  if (moved === 0n) return false
  // A cycle is not finished when the cbBTC comes back; it is finished when the
  // cbBTC has been SPLIT. Money sitting unsplit in the revenue ATA is money the
  // holders have not been paid, and treating the return as the end let a failed
  // `split_revenue` look like a completed cycle.
  return BigInt(c?.returnedSats ?? 0) === 0n || !(c?.splitSig || c?.splitByOther)
}

export function detectUnreconciledRevenue(ledger, opts = {}) {
  const graceMs = (opts.graceMinutes ?? 60) * 60_000
  const nowMs = opts.now ?? Date.now()
  // How far below the quote a return may land and still count as delivered.
  const tol = opts.shortfallTolerance ?? 0.02
  const out = []
  if (ledger === null || ledger === undefined) {
    // A MISSING LEDGER IS NOT A QUIET DAY. alarm.mjs used to swallow this with
    // `catch { /* no ledger yet is not a finding */ }`, which meant deleting one
    // file turned off the only watch over the one trusted hop in the system —
    // in a pipeline whose header says a read that fails is an alarm.
    out.push({ kind: 'revenue_ledger_unreadable', severity: S.CRITICAL,
      detail: 'the revenue ledger could not be read. Every claim about SOL swept for the swap rests on that file, so an unreadable one is a blind spot, not an empty one. If no cycle has ever run, create it as {"cycles":[]} deliberately.' })
    return out
  }
  for (const c of (ledger.cycles || [])) {
    const age = nowMs - Date.parse(c.startedAt)
    const swept = BigInt(c.sweptLamports || c.intendedLamports || 0)
    if (!cycleIsOpen(c)) {
      // Closed, or never moved. Still hold a RETURN to its quote below.
      if (swept === 0n || BigInt(c.returnedSats ?? 0) === 0n) continue
    } else {
      if (age < graceMs) continue        // a cycle in flight is not a finding
    }
    const returned = BigInt(c.returnedSats ?? 0)
    if (returned === 0n) {
      if (age < graceMs) continue
      out.push({ kind: 'unreconciled_swap', severity: S.CRITICAL,
        detail: `${swept} lamports left the revenue address at ${c.startedAt} and NO cbBTC came back (${Math.round(age / 60000)} min ago)${c.sweptLamports ? '' : ' — and the sweep itself was never confirmed into the ledger, so the amount is the intent'}` })
      continue
    }
    // A CYCLE THAT RETURNED AND WAS NEVER SPLIT. `cycleIsOpen` calls this money
    // the holders have not been paid, and then nothing said so: the only checks
    // here were "returned nothing" and "returned less than quoted", so cbBTC
    // sitting unsplit in the revenue ATA produced ZERO findings. The only signal
    // was `revenue.mjs`'s own guard throwing on its next run — the actor as the
    // sole watcher of its own failure, which is the shape round 7 removed from
    // the sweep side and left standing here.
    // GRACED FROM THE RETURN, NOT THE SWEEP. This check had no age gate at all,
    // so every alarm pass that landed in the seconds between step 3 and step 4
    // of a live cycle raised a HIGH about money that was being split as it read.
    // Two false alarms teach a human to scroll past the third.
    const sinceReturn = nowMs - Date.parse(c.returnedAt || c.startedAt)
    if (returned > 0n && !c.splitSig && !c.splitByOther && sinceReturn >= graceMs) {
      out.push({ kind: 'cycle_unsplit', severity: S.HIGH,
        detail: `cycle ${c.startedAt} returned ${returned} sats and has no split. That cbBTC is sitting in the revenue address undivided, which is money the holders have not been paid.` })
    }
    // Returning ONE SATOSHI against fifty SOL also used to read as reconciled.
    // The quote is what we were told to expect; hold the return to it.
    const quoted = BigInt(c.quotedSats ?? 0)
    if (quoted > 0n) {
      const floor = quoted - (quoted * BigInt(Math.round(tol * 10_000)) / 10_000n)
      if (returned < floor) {
        out.push({ kind: 'short_swap_return', severity: S.CRITICAL,
          detail: `cycle ${c.startedAt} swept ${swept} lamports, was quoted ${quoted} sats and only ${returned} came back (below the ${tol * 100}% tolerance). The hop is trusted; it is not unmeasured.` })
      }
    }
  }
  return out
}

/**
 * Token accounts a vault PDA owns that are NOT canonical reserve ATAs.
 *
 * Pure, so the JUDGEMENT is tested even though the enumeration it runs on cannot
 * be: `getTokenAccountsByOwner` needs a real cluster and DAS, and the local
 * validator has neither. Keeping the decision here means the only untested part
 * of the reconcile is the I/O.
 *
 * `burn_vault` can check only what a caller DECLARES, so an undeclared account's
 * contents are destroyed with the vault. Nothing on-chain can enumerate these —
 * that is a property of Core, not a choice — and no signature scan can see one
 * being created either, because creating a token account owned by a PDA needs no
 * signature from the PDA and touches none of our programs.
 */
export function detectUndeclaredTokenAccounts(asset, expectedAtas, owned) {
  const out = []
  const expected = new Set(expectedAtas)
  for (const { address, amount } of owned) {
    if (expected.has(address)) continue
    out.push({ kind: 'undeclared_token_account', severity: S.CRITICAL, asset,
      detail: `vault ${asset} owns token account ${address} (${amount} units) that is NOT a canonical reserve ATA. burn_vault checks only DECLARED accounts, so this balance is destroyed with the vault unless someone declares it. The holder must declare it in their redemption, or it is lost.` })
  }
  return out
}

/**
 * A FINDING WITH NO WAY TO BE ANSWERED IS ONE THAT GETS IGNORED.
 *
 * That rule is already written in `detectDistribution`, where `resolvedBy` closes
 * three branches that would otherwise nag forever. Round 14 found the two
 * detectors added in round 13 breaking it, in the same commit that quoted it:
 *
 *   * `vault_owns_itself` is bricked BY CONSTRUCTION (proven impossibility 3).
 *   * `nested_vault` inside a BURNT host is unrecoverable — that host's PDA can
 *     never sign again — and the selftest asserts it fires.
 *   * `unredeemable_owner` on a DAO-held vault clears only if the DAO transfers
 *     it back out, which it may never do.
 *
 * Each would raise a CRITICAL every thirty minutes, forever, with nothing anyone
 * can do about it — which is exactly how the ONE detector that matters
 * (`vault_left_index`, the sole sight of a bare Core BurnV1) gets scrolled past.
 *
 * AN ACK DOWNGRADES; IT DOES NOT DELETE. The finding still prints, under INFO,
 * WITH the reason attached, so an acknowledged condition stays visible and only
 * stops paging. Silencing something entirely is how it stops being true without
 * anyone noticing.
 *
 * THE REASON IS MANDATORY. A non-empty string, not `true` — an ack with no
 * argument is indistinguishable from a mistake, and it is the only record of why
 * a permanent CRITICAL was accepted.
 *
 * Keyed `<kind>:<asset>`, so acknowledging one vault's nesting says nothing about
 * the next vault's, and acknowledging a nesting says nothing about an approve on
 * the same asset.
 *
 * BLIND TO: an ack that was true when written and is not any more. That is why it
 * downgrades rather than drops, and why the report prints the count.
 */
/**
 * DID THE REDEMPTION DECLARE EVERYTHING THE VAULT ACTUALLY HOLDS?
 *
 * The other half, and the one the old comments promised. `owned` comes from a
 * LIVE scan of the asset-signer PDA (token accounts via getTokenAccountsByOwner
 * on both token programs, Core assets via DAS), so this is pure and testable
 * while the scan is I/O.
 *
 * A holding that is not declared is DESTROYED by the burn — Core's BurnV1 does
 * not sweep the asset-signer PDA and nothing can sign for it afterwards. That is
 * the whole reason to refuse.
 */
export function judgeRedemptionCoverage(owned, declared) {
  const bad = []
  const seen = new Set(declared)
  for (const h of owned) {
    // AN UNDECLARABLE ACCOUNT IS REFUSED WHETHER OR NOT IT IS DECLARED, because
    // declaring it makes BURN revert (`ReserveHasExtensions`) and NOT declaring
    // it orphans whatever it holds. See `classifyPdaTokenAccount`.
    if (h.undeclarable) {
      bad.push(`${h.address} is a Token-2022 account owned by this vault that carries EXTENSIONS `
        + `(${h.dataLen} bytes, not 165). burn_vault REFUSES it as a declared account, and leaving it `
        + `undeclared orphans it and anything it holds — its balance cannot be read from the base layout. `
        + `This redemption needs a human.`)
      continue
    }
    if (seen.has(h.address)) continue
    bad.push(`${h.kind === 'asset' ? 'a Core ASSET' : `${h.amount} units of a token`} at ${h.address} is owned by this vault and is NOT declared in the burn — it would be DESTROYED`)
  }
  return { ok: bad.length === 0, reasons: bad }
}

/**
 * IS THIS PDA-OWNED TOKEN ACCOUNT SOMETHING THE BURN MUST ACCOUNT FOR?
 *
 * The scan half of the co-signer used to be one line — `if (amount !== '0')` off
 * `data.readBigUInt64LE(64)` — and that is the same mistake BURN's own second
 * loop was fixed for a round earlier, in a comment that spells out why:
 *
 *   "The reserve loop refuses Token-2022 extensions because a confidential
 *    balance reads zero in the base `amount`. This loop did not, so a NON-reserve
 *    T22 token with extensions could pass the emptiness proof holding real value."
 *
 * The on-chain code knows that a zero in the base field is not an empty account.
 * The scan written later did not, so an extension-bearing account read as nothing
 * and the co-signer called the redemption clean. One of two identical sites,
 * again.
 *
 * THREE OUTCOMES, and the middle one is the honest new answer:
 *   * 165 bytes, amount 0        -> IGNORED. A classic empty token account. Its
 *                                   RENT is lost with the burn (~0.002 SOL) and
 *                                   that is a stated limit, not principal.
 *   * NOT 165 bytes              -> UNDECLARABLE. Token-2022 extensions. Value
 *                                   may live in a confidential balance or in
 *                                   `TransferFeeAmount.withheld_amount`, neither
 *                                   readable here, and BURN refuses the account
 *                                   as declared. We cannot prove it empty and we
 *                                   cannot let it through, so we refuse and say
 *                                   which. ⚠️ THIS IS A GRIEFING SURFACE, stated
 *                                   rather than hidden: anyone can create such an
 *                                   account for any vault's PDA for dust and
 *                                   block its clean redemption. The on-chain
 *                                   behaviour without this check is to orphan it
 *                                   SILENTLY, so the choice is a visible block
 *                                   against an invisible loss, and this project
 *                                   takes the visible one every time. An operator
 *                                   who has looked can still sign by hand.
 *   * 165 bytes, amount != 0     -> must be declared, as before.
 *
 * BLIND TO: the actual size of a confidential or withheld balance. Reading it
 * means parsing the Token-2022 TLV, which is a new parser and a new place for a
 * defect; refusing on "we cannot tell" is the same rule the DAS page guard uses.
 */
export function classifyPdaTokenAccount({ address, dataLen, amount }) {
  const amt = typeof amount === 'bigint' ? amount : BigInt(amount ?? 0)
  if (dataLen !== 165) return { address, kind: 'token', amount: amt.toString(), dataLen, undeclarable: true }
  if (amt === 0n) return null
  return { address, kind: 'token', amount: amt.toString(), dataLen }
}

/** The JUDGEMENT half of reading an ack file, so it is testable both ways while
 *  `alarm.mjs` keeps only the I/O — the same split as the reconcile. Returns
 *  `{acks, problem}`: `problem` is non-null when the file EXISTS and is broken,
 *  which must be loud, because a bare catch cannot tell that from "no acks yet"
 *  and the difference is a silent mute button. */
export function parseAcks(raw) {
  if (raw === null || raw === undefined) return { acks: {}, problem: null }
  let a
  try { a = JSON.parse(raw) } catch (e) { return { acks: {}, problem: `malformed JSON: ${e.message}` } }
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { acks: {}, problem: 'not a JSON object' }
  return { acks: a, problem: null }
}

/**
 * AN ACK EXPIRES. ROUND 16, and it is the answer to two auditors at once.
 *
 * Round 15 scoped acks to three kinds "whose condition is unanswerable BY
 * CONSTRUCTION". Two round-16 auditors pointed out that is false of the kinds as
 * a class: a `nested_vault` inside a LIVE host is recoverable — its owner can
 * Execute the inner vault straight back out — and only a BURNT host makes it
 * permanent. `unredeemable_owner` on a marketplace escrow clears on delisting.
 * So the kind allowlist stops the worst case (nobody can ack a bare burn) and
 * does NOT establish that a given condition is unanswerable.
 *
 * Judging recoverability per asset is not something this file can do. Bounding
 * how long a human's judgement is trusted IS. `detectors.mjs` already named the
 * exact blind spot — "an ack that was true when written and is not any more" —
 * and an expiry converts it from permanent to bounded: the operator has to look
 * again and say so.
 *
 * SHAPE: `{"<kind>:<asset>": {"why": "...", "until": "YYYY-MM-DD"}}`. Both
 * fields are mandatory. There is no bare-string form: a string cannot carry an
 * expiry, and accepting both would mean the shape that never expires is also the
 * shape that is easiest to write.
 */
export function judgeAck(entry, now = Date.now()) {
  if (entry === undefined || entry === null) return { ok: false, why: null, problem: null }
  if (typeof entry !== 'object' || Array.isArray(entry)) {
    return { ok: false, why: null, problem: 'an ack must be {"why": "...", "until": "YYYY-MM-DD"}, not a bare value' }
  }
  const why = typeof entry.why === 'string' ? entry.why.trim() : ''
  if (!why) return { ok: false, why: null, problem: 'the ack has no `why` — an ack with no argument is indistinguishable from a mistake' }
  if (typeof entry.until !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.until)) {
    return { ok: false, why, problem: 'the ack has no `until` date (YYYY-MM-DD) — an ack that never expires is a permanent mute on a condition that may become actionable' }
  }
  // End of the named day, so `until` reads the way a human means it.
  const expiry = Date.parse(`${entry.until}T23:59:59Z`)
  if (!Number.isFinite(expiry)) return { ok: false, why, problem: `\`until\` is not a real date: ${entry.until}` }
  if (now > expiry) return { ok: false, why, problem: `this ack EXPIRED on ${entry.until} — look again and re-affirm it, or fix the condition` }
  return { ok: true, why, problem: null, until: entry.until }
}

/**
 * ONLY THE THREE KINDS THE ACK WAS BUILT FOR MAY BE ACKED.
 *
 * ROUND 15. `applyAcks` would downgrade ANY asset-scoped finding, so a line in
 * `bank/acks.json` reading `vault_burned:<asset>` silenced the paging for a REAL
 * bare Core BurnV1 on that vault — the one attack the programs structurally
 * cannot prevent, and the exact thing `vault_left_index` and `vault_burned` exist
 * to shout about. The ack was written to stop three PERMANENT findings nagging
 * (a bricked vault, a nested vault in a burnt host, a DAO-held vault), and
 * "nobody can act on this" is a property of those three kinds, not of an asset.
 *
 * So the ack is scoped to the kinds whose condition is unanswerable BY
 * CONSTRUCTION. Everything else is actionable, which means silencing it is
 * always wrong, however good the reason in the file sounds.
 *
 * ⚠️ ADDING A KIND HERE IS A DECISION. Ask what an operator would DO about the
 * finding; if there is an answer, it does not belong in this set.
 */
export const ACKABLE_KINDS = new Set(['vault_owns_itself', 'nested_vault', 'unredeemable_owner'])

export function applyAcks(findings, acks = {}, now = Date.now()) {
  return findings.map(f => {
    if (!f.asset || !f.kind) return f
    const j = judgeAck(acks[`${f.kind}:${f.asset}`], now)
    // A MALFORMED OR EXPIRED ACK IS REPORTED, NOT IGNORED. Somebody wrote that
    // line meaning to mute something; a mute button that quietly does nothing is
    // as bad as one that quietly works.
    if (j.problem) {
      return { ...f, ackRefused: true,
        detail: `${f.detail}\n     ⚠️ AN ACK FOR THIS FINDING EXISTS AND WAS REFUSED: ${j.problem}` }
    }
    if (!j.ok) return f
    const why = j.why
    // AN ACK ON AN UNACKABLE KIND IS ITSELF REPORTED, at full severity, rather
    // than ignored in silence. Somebody wrote that line meaning to mute
    // something, and a mute button that quietly does nothing is as bad as one
    // that quietly works.
    if (!ACKABLE_KINDS.has(f.kind)) {
      return { ...f, ackRefused: true,
        detail: `${f.detail}\n     ⚠️ AN ACK FOR THIS FINDING EXISTS AND WAS REFUSED: `
          + `"${why}". Only ${[...ACKABLE_KINDS].join(', ')} may be acknowledged — `
          + `every other finding has something an operator can do about it.` }
    }
    return { ...f, severity: S.INFO, acked: true,
      detail: `${f.detail}\n     ACKNOWLEDGED until ${j.until}: ${why}` }
  })
}

/**
 * TELL A REDEMPTION FROM A BARE CORE BURN, using findings this pass already has.
 *
 * THE PROBLEM THIS SOLVES. `detectVaultSetChange` reports CRITICAL for every vault
 * that leaves the live set, and under v5 that is every customer redemption. The
 * ONE thing that detector exists for — a bare Core `BurnV1`, the single attack the
 * programs cannot prevent — would arrive as the fifty-first identical CRITICAL of
 * the week. A detector nobody reads is not a detector.
 *
 * THE DISCRIMINATOR IS ALREADY IN HAND. A vault that vanished AND whose
 * `burn_vault` was seen in a scanned transaction went through the program: the
 * emptiness proof ran, and the chain guarantees a paired
 * thaw. A vault that vanished with NO `burn_vault` anywhere is what a bare Core
 * burn looks like, and nothing checked its contents.
 *
 * IT FAILS SAFE, DELIBERATELY. If the signature walk has not yet reached the burn
 * transaction that the DAS diff has already noticed, the two do not correlate and
 * the finding stays CRITICAL. That is a false alarm on a legitimate redemption,
 * which is the direction to be wrong in — the alternative is silence on a real
 * one. It is also self-correcting: the next pass sees both.
 *
 * A PURE POST-PASS over the finished findings list, so it needs no reordering of
 * the alarm and no new state.
 *
 * ⚠️ IT ORIGINALLY REWROTE ONE OF FOUR SITES, AND ROUND 14 CAUGHT IT.
 * A redemption of an ACTIVATED vault does not produce one finding, it produces
 * several, from detectors that never mention burning:
 *   * `vault_burned`   — the vault left the live DAS set (CRITICAL)
 *   * `vault_vanished` — it was activated and its balance is no longer readable
 *                        at all, from `detectDeactivations` (CRITICAL)
 *   * `deactivated`    — DAS lagged a pass, so it is still listed with its ATA
 *                        already closed (HIGH)
 *   * `reserve_fell`   — same lag, seen by `detectBalanceDrops` (HIGH)
 * The first version rewrote only `vault_burned`, so every honest exit still rang
 * a CRITICAL and `vault_left_index` stayed buried — the fix delivering none of
 * what it was written for. That is this project's single most repeated defect
 * (**a fix applied to one of N identical sites**) appearing inside the commit
 * written to remove that class.
 *
 * THE LIST IS AN ALLOWLIST, NOT A BLANKET. Only kinds a redemption LEGITIMATELY
 * produces are downgraded. An approve by the vault's PDA, a nested vault or an
 * undeclared token account on the SAME asset stays at full severity, because
 * those describe something that should never have happened whether or not the
 * vault was then destroyed — and quieting them is how a burn becomes a way to
 * launder the evidence of one.
 *
 * BLIND TO: a burn whose transaction the signature walk will never reach (a
 * `scan_gap`, which raises its own HIGH), and to whether the redemption was
 * COMPLETE — `correlate` says the program ran, never that nothing was orphaned.
 * That is `detectNestedVaults` and `detectUndeclaredTokenAccounts`.
 */
/** The only kinds a legitimate redemption produces. Everything else survives. */
const REDEMPTION_NOISE = {
  vault_burned: a => `vault ${a} was REDEEMED: burn_vault ran on it in a transaction this pass scanned, so the emptiness proof ran. Anything undeclared is still orphaned — that is what the nested-vault and undeclared-account detectors are for.`,
  vault_vanished: a => `vault ${a} is no longer readable because it was REDEEMED and burned, not because it went dark. burn_vault ran on it in a transaction this pass scanned.`,
  deactivated: a => `vault ${a} fell below activation because it was REDEEMED and burned in a transaction this pass scanned. The index is one pass behind.`,
  reserve_fell: a => `vault ${a}'s reserve fell because it was REDEEMED and burned in a transaction this pass scanned. The index is one pass behind.`,
}
export function correlateBurns(findings) {
  const viaProgram = new Set()
  for (const f of findings) if (f.kind === 'burn_via_program' && f.asset) viaProgram.add(f.asset)
  const out = []
  const seenInfo = new Set()
  for (const f of findings) {
    // The redemption transaction is scanned once per program it touches, so the
    // same burn arrives twice. Report it once.
    if (f.kind === 'burn_via_program') {
      if (f.asset && seenInfo.has(f.asset)) continue
      if (f.asset) seenInfo.add(f.asset)
      out.push(f); continue
    }
    if (f.asset && viaProgram.has(f.asset) && REDEMPTION_NOISE[f.kind]) {
      out.push({ ...f, severity: S.INFO, detail: REDEMPTION_NOISE[f.kind](f.asset) })
      continue
    }
    if (f.kind === 'vault_burned' && f.asset) {
      out.push({ ...f,
        detail: `${f.detail} NO burn_vault was seen for it in any transaction this pass scanned, which is what a BARE Core BurnV1 looks like — nothing checked the contents.` })
      continue
    }
    out.push(f)
  }
  return out
}

/**
 * A VAULT INSIDE A VAULT — the hazard v5 turned from stranding into destruction.
 *
 * Core permits transferring a vault asset to another vault's asset-signer PDA
 * (MEASURED on a validator, suite 9.1). Two things follow, and both are bad:
 *
 *   * THE INNER VAULT CAN NEVER BE REDEEMED. Its owner is a PDA, and both Core's
 *     ExecuteV1 and `open_for_redemption` demand the owner's SIGNATURE. Suite 9.3.
 *   * BURNING THE OUTER VAULT DESTROYS IT. `burn_vault` refuses a DECLARED live
 *     Core asset (9.4) but cannot enumerate an undeclared one, so the burn is
 *     allowed and the inner vault is orphaned behind an asset-signer PDA nobody
 *     can ever sign for again (9.5, 9.6). Under v2-v4 that was stranding; under
 *     v5 every redemption ends in a burn, so it is the normal exit.
 *
 * NOTHING WAS LOOKING FOR THIS. `reconcile()` scans `getTokenAccountsByOwner`,
 * which sees tokens and is structurally blind to a Core asset; the signature tail
 * cannot see it either, because nesting is a plain Core TransferV1 that touches
 * none of our four programs. BURN's header and SEAL's both say the gap is covered
 * by "the off-chain scanner" — for TOKENS that was true and for a nested VAULT it
 * was not, which is the same shape as the round-6 finding where BURN's header
 * promised a reconcile no shipped file called.
 *
 * IT COSTS NOTHING TO RUN. `listVaults` already fetches every asset in the
 * collection from DAS and threw the owner away; this reads the field that was
 * already on the wire. No extra RPC call, every pass, not once a day.
 *
 * BLIND TO: a FOREIGN Core asset (one outside our collection) nested inside a
 * vault. That needs a per-vault DAS owner search, and this detector does not do
 * one: it walks OUR collection. `reconcile()` cannot help — it uses
 * `getTokenAccountsByOwner`, which is structurally blind to a Core asset. An
 * earlier version of this comment said it was "the reconcile's job", which named
 * a control that does not run: the same defect class this file exists to catch,
 * written into the fix for it, and caught by round 14 rather than by me.
 *
 * ⚠️ v6 (2026-10-03) DELETED THE ONE THING THAT USED TO CATCH IT. Under v5 the
 * Bank's co-signer ran a DAS owner search on the vault's asset-signer PDA before
 * it would co-sign a redemption, and a foreign nested asset failed CLOSED. v6 has
 * no Bank (Gary: the program is the second signer), so NOTHING refuses a
 * redemption that will destroy a foreign asset inside the vault. The pure
 * judgement survives as `judgeRedemptionCoverage`, kept for the redeem page,
 * which must run it before the holder signs — and that page is not built yet.
 * Until it is, a holder who sends a foreign asset into their vault learns about
 * it only from this detector, which does not do the per-vault owner search for
 * foreign assets either. Stated here so nobody reads the v5 control as live.
 * Also blind to anything DAS has not indexed yet.
 *
 * ⚠️ ROUND 14: NESTING IS THE NARROW SUBCASE OF A GENERAL ONE, and the first
 * version of this detector caught only the narrow one.
 *
 * A vault owned by ANY address that cannot sign a TOP-LEVEL instruction can never
 * be redeemed — v5 needs `open_for_redemption` and `burn_vault` as two top-level
 * instructions signed by the owner, and a program address signs only by CPI, which
 * makes both halves inner and the pairing refuse. That is the IDENTICAL mechanism
 * as v5's Bank-signability check, and round 13 checked the Bank and not the owner:
 * a fix applied to one of two identical sites, for the third time in this file's
 * history.
 *
 * IT IS REACHABLE BY ACCIDENT, NOT JUST BY MISTAKE. MINT requires `owner: Signer`
 * and its comment calls that "strictly stronger" than an on-curve test. It is not:
 * `is_signer` is TRUE for a PDA passed as a CPI signer, so a DAO buying a charter
 * vault from its Squads treasury satisfies it, pays, deposits real cbBTC and
 * receives a permanently sealed asset. Test 5.2 does NOT cover this — it passes
 * the PDA with `isSigner:false` and is refused by `AccountNotSigner`, which is a
 * different property. Nothing on-chain can refuse it either (`is_on_curve` panics
 * on BPF), so detection is the whole control.
 *
 * KNOWN AMBIGUITY, STATED RATHER THAN GUESSED: an off-curve owner may also be a
 * marketplace escrow holding a listed vault, which is RECOVERABLE — the seller
 * delists and it comes back. We do not yet know whether Core marketplaces escrow
 * the asset or use a transfer delegate that leaves ownership alone, so there is no
 * allowlist here and the finding names both readings. Nothing has minted, so there
 * are zero false positives today; missing a permanently sealed vault is much worse
 * than naming a listed one.
 *
 * @param vaults     [{ id, owner }] straight off the DAS page
 * @param pdaOf      id -> asset-signer PDA, computed by the caller (this file
 *                   stays free of web3 so it can be driven with synthetic input)
 * @param isOnCurve  pubkey -> boolean, injected for the same reason
 */
export function detectNestedVaults(vaults, pdaOf, isOnCurve) {
  const out = []
  // Every vault's PDA, INCLUDING BURNT ONES: a vault nested inside an already
  // burned vault is the worst case, not an excluded one.
  const owners = new Map()
  for (const v of vaults) { const p = pdaOf(v.id); if (p) owners.set(p, v.id) }
  for (const { id, owner } of vaults) {
    if (!owner) continue
    const host = owners.get(owner)
    if (host === undefined) continue
    if (host === id) {
      out.push({ kind: 'vault_owns_itself', severity: S.CRITICAL, asset: id,
        detail: `vault ${id} is owned by its OWN asset-signer PDA. It is bricked forever: no key can sign as that PDA without Core's ExecuteV1, and ExecuteV1 needs the owner's signature. Its contents cannot be redeemed by anyone.` })
      continue
    }
    out.push({ kind: 'nested_vault', severity: S.CRITICAL, asset: id,
      detail: `vault ${id} is owned by vault ${host}'s asset-signer PDA (${owner}). It CANNOT be redeemed while it is there — a PDA cannot sign — and burning ${host} DESTROYS it unless it is declared in the burn. Its owner must move it out (it cannot sign while nested) before ${host} is redeemed, or it is lost.` })
  }
  // ---- the general case: ANY owner that cannot sign a top-level instruction ----
  for (const { id, owner } of vaults) {
    if (!owner) continue
    if (owners.has(owner)) continue            // already named above, more precisely
    let ok
    try { ok = isOnCurve(owner) } catch { ok = null }
    if (ok === null || ok) continue            // unreadable is NOT a verdict
    out.push({ kind: 'unredeemable_owner', severity: S.CRITICAL, asset: id,
      detail: `vault ${id} is owned by ${owner}, which is OFF-CURVE — a program address, not a keypair. Redemption needs open_for_redemption and burn_vault as TWO TOP-LEVEL instructions signed by the owner, and a program signs only by CPI, which makes both halves inner and the pairing refuse. Either this vault is listed on a marketplace that escrows it (recoverable: delist and it returns) or its contents are sealed for good. MINT's owner-must-sign rule does NOT prevent this — is_signer is true for a PDA passed as a CPI signer.` })
  }
  return out
}

/**
 * A SWEEP THAT OUR OWN SCRIPT DID NOT MAKE.
 *
 * `sweep_sol_for_swap` moves real SOL and the ONLY thing reconciling it was
 * `revenue-ledger.json` — a file written by the same process, as the same user,
 * on the same box, as the swap-operator key it is supposed to be auditing. Four
 * auditors said the same thing in round 7: the ledger is the audited key's own
 * testimony. Anyone holding that key could sweep directly, write nothing, and
 * every detector stayed quiet forever.
 *
 * The alarm already fetches and normalises every MINT transaction. This reads
 * the sweeps out of them and demands a ledger row for each. A sweep with no row
 * is CRITICAL whoever made it: either the key is being used outside the cron, or
 * the ledger the whole reconciliation rests on is not complete.
 *
 * BLIND TO: a sweep in a transaction the signature scan has not reached yet —
 * which is why it is checked every pass rather than once.
 */
export function detectUnledgeredSweeps(ixs, mintProgramId, sweepDiscriminator, ledger, signature, opts = {}) {
  const out = []
  // `deferred` is the caller's list of sweeps seen too recently to judge. The
  // cursor advances past a transaction once it is scanned, so a sweep skipped
  // for being fresh is never looked at AGAIN — which meant a sweep timed a few
  // minutes before a pass was never examined at all, and the legitimate cron
  // (sweep :41, alarm :53) was ALWAYS inside the window. That killed the whole
  // control for exactly the case it exists for.
  const defer = opts.deferred
  const byS = new Map((ledger?.cycles || []).filter(c => c.sweepSig).map(c => [c.sweepSig, c]))
  // A cycle written a moment after the transaction landed is not a finding: the
  // alarm can scan a sweep before revenue.mjs has saved its row. Only a sweep
  // that has had time to be recorded counts.
  const graceSecs = opts.graceSecs ?? 900
  const stale = !opts.blockTime || !opts.now || (opts.now - opts.blockTime) > graceSecs
  for (const ix of ixs) {
    if (ix.program !== mintProgramId) continue
    const d = ix.dataBytes
    if (!d || d.length < 16) continue
    if (!sweepDiscriminator.every((b, i) => d[i] === b)) continue
    // THE AMOUNT IS IN THE INSTRUCTION, so read it rather than taking the
    // ledger's word. Matching on the SIGNATURE alone let whoever holds the
    // operator key sweep the cap and then write a row claiming one lamport: the
    // detector would have been satisfied by a row it did not check.
    let onchain = 0n
    for (let i = 7; i >= 0; i--) onchain = (onchain << 8n) | BigInt(d[8 + i])
    const row = signature ? byS.get(signature) : null
    if (!row) {
      if (!stale) {
        if (defer) defer.push({ sig: signature, blockTime: opts.blockTime, amount: String(onchain) })
        continue
      }
      out.push({ kind: 'unledgered_sweep', severity: S.CRITICAL,
        detail: `${onchain} lamports were swept out of the revenue address by transaction ${signature || '(unknown)'}, and no cycle in the revenue ledger records it. Either the operator key is being used outside bank/revenue.mjs, or the ledger is not a complete record of the trusted hop.` })
      continue
    }
    const claimed = BigInt(row.sweptLamports ?? row.intendedLamports ?? 0)
    if (claimed !== onchain) {
      out.push({ kind: 'sweep_amount_mismatch', severity: S.CRITICAL,
        detail: `transaction ${signature} swept ${onchain} lamports and the ledger row for it claims ${claimed}. The chain is the fact; the ledger is written by the same process that holds the operator key.` })
    }
  }
  return out
}

/**
 * SWEEPS THE LAST PASS COULD NOT YET JUDGE, judged now.
 *
 * The scan cursor only moves forward, so a sweep skipped for being too fresh is
 * never re-fetched. Carrying them in alarm state is the only way the grace
 * window can be a delay rather than a hole.
 */
export function detectDeferredSweeps(deferred, ledger, opts = {}) {
  const out = [], keep = []
  const graceSecs = opts.graceSecs ?? 900
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const byS = new Map((ledger?.cycles || []).filter(c => c.sweepSig).map(c => [c.sweepSig, c]))
  for (const d of (deferred || [])) {
    const row = byS.get(d.sig)
    if (row) {
      const claimed = BigInt(row.sweptLamports ?? row.intendedLamports ?? 0)
      if (claimed !== BigInt(d.amount)) {
        out.push({ kind: 'sweep_amount_mismatch', severity: S.CRITICAL,
          detail: `transaction ${d.sig} swept ${d.amount} lamports and the ledger row for it claims ${claimed}.` })
      }
      continue                       // resolved either way; stop carrying it
    }
    if (now - (d.blockTime ?? 0) < graceSecs) { keep.push(d); continue }
    out.push({ kind: 'unledgered_sweep', severity: S.CRITICAL,
      detail: `${d.amount} lamports were swept out of the revenue address by transaction ${d.sig} and no cycle in the revenue ledger has recorded it since. The scan cursor has moved past that transaction, so this is carried in the alarm's own state rather than re-read from chain.` })
  }
  return { findings: out, keep }
}

/**
 * A SPLIT ON CHAIN THAT NO CYCLE CLAIMS, or a cycle claiming one that is not there.
 *
 * Round 7 made the SWEEP side chain-derived and left the RETURN side resting on
 * `returnedSats`, written by the process that holds the operator key. Two
 * round-8 auditors said so independently. The alarm already fetches every MINT
 * transaction, so the other end of the hop is one discriminator away: a cycle
 * that says it split must name a `splitSig` the scan has actually seen, and a
 * split the scan sees must belong to a cycle.
 *
 * BLIND TO: the AMOUNT. `RevenueSplit` carries it in an event, and parsing
 * Anchor event logs out of a jsonParsed transaction is a bigger machine than
 * this file should grow tonight. What this closes is the cheap lie — claiming a
 * split that never happened — and that is stated rather than implied.
 */
/** Entries were bare signature strings until round 12 and are `{sig, blockTime}`
 *  now. Both shapes are accepted so an existing state file keeps working; an old
 *  bare string simply has no block time and cannot anchor by ordering. */
export function splitSig(e) { return typeof e === 'string' ? e : e?.sig }
export function splitTime(e) { return typeof e === 'string' ? null : (e?.blockTime ?? null) }
export function dedupeSeenSplits(list) {
  const by = new Map()
  for (const e of (list || [])) {
    const k = splitSig(e); if (!k) continue
    // Prefer the richer record if the same signature arrives in both shapes.
    if (!by.has(k) || (splitTime(by.get(k)) == null && splitTime(e) != null)) by.set(k, e)
  }
  return [...by.values()]
}

export function detectSplitClaims(seenSplitSigs, ledger, opts = {}) {
  const out = []
  const graceMs = (opts.graceMinutes ?? 60) * 60_000
  const nowMs = opts.now ?? Date.now()
  const entries = dedupeSeenSplits(seenSplitSigs)
  const seen = new Set(entries.map(splitSig))
  // ⚠️ THE HORIZON IS A LEDGER POSITION NOW, NOT A CLAIMED TIMESTAMP.
  //
  // Round 12: `startedAt` is written by the same process that holds the operator
  // key, and the upper bound was computed from it — so a compromised operator
  // that swept 50 SOL and kept it needed only to BACKDATE the row past 30 days.
  // `detectSplitClaims` then computed `age > horizonMs`, skipped the cycle, and
  // NEVER ASKED WHETHER A SPLIT EXISTED. The stated rationale ("the scan has
  // moved past it") was false anyway: `seenSplits` is deliberately never sliced.
  //
  // Position in the ledger cannot be forged by editing a timestamp, and a
  // backdated row is still one of the most recent entries. The lower GRACE
  // bound stays on the clock, because it only ever suppresses a cycle that is
  // genuinely in flight and erring toward silence there is safe.
  const verifyLastN = opts.verifyLastN ?? 200
  // Reuse is checked across the WHOLE ledger, not just the window, so an old
  // signature pasted into a fresh row is caught even when the cycle it was
  // stolen from is past the horizon.
  const claimed = new Set()
  const byOther = []
  const cycles = ledger?.cycles || []
  const recent = new Set(cycles.slice(-verifyLastN))
  for (const c of cycles) {
    // `split_revenue` is permissionless, so a stranger front-running our call is
    // normal and harmless: their split divided our cbBTC by the same enforced
    // rule to the same pinned addresses. What we lose is the signature, not the
    // money, and demanding one anyway would have wedged the pipeline forever.
    // Counted, then anchored against the chain after the loop. Skipping these
    // outright closed a cycle on the operator's own testimony with nothing on
    // chain behind it, in a pipeline whose stated reason for existing is that
    // the ledger is the audited key's own word.
    if (c.splitByOther) { byOther.push(c); continue }
    if (!c.splitSig) continue
    if (claimed.has(c.splitSig)) {
      out.push({ kind: 'split_sig_reused', severity: S.CRITICAL,
        detail: `split ${c.splitSig} is claimed by more than one revenue cycle. A signature can close exactly one; a reused one closes a cycle whose cbBTC was never divided.` })
      continue
    }
    claimed.add(c.splitSig)
    if (!recent.has(c)) continue
    if (nowMs - Date.parse(c.startedAt) < graceMs) continue
    if (!seen.has(c.splitSig)) {
      out.push({ kind: 'split_not_on_chain', severity: S.CRITICAL,
        detail: `cycle ${c.startedAt} records split ${c.splitSig}, which the transaction scan has not seen on the MINT program. A cycle that claims a split it cannot show is a cycle whose cbBTC may still be sitting unsplit.` })
    }
  }
  // EVERY `splitByOther` CYCLE MUST POINT AT A REAL SPLIT NOBODY ELSE CLAIMS.
  //
  // Round 10 closed "two rows, one signature" and opened its mirror: one real
  // split, no claimant, and a later row that closes itself for free by simply
  // asserting `splitByOther: true`. The operator process writes this ledger, and
  // the whole point of the scan is that its testimony is not enough.
  //
  // The anchor needs no event parsing. A front-run split IS a MINT transaction,
  // so it is in `seenSplits`; if N cycles claim someone else split for them,
  // there must be at least N splits on chain that no cycle claims by signature.
  // Same window as the check above: too new to have been scanned is not a fault,
  // and past the horizon it can no longer be asked.
  const inWindow = byOther.filter(c => recent.has(c) && nowMs - Date.parse(c.startedAt) >= graceMs)
  if (inWindow.length) {
    // ⚠️ ATTRIBUTION, NOT CARDINALITY.
    //
    // Round 11 asked only whether the NUMBER of unclaimed splits was at least
    // the number of cycles claiming one, binding no split to any cycle — not by
    // amount, not by return, not even by ordering. So a single unclaimed split
    // from any time, including one that landed before the cycle existed, could
    // vouch for a cycle forever, and my own selftest asserted that as correct.
    //
    // Each cycle must now be matched to its OWN anchor: a cbBTC split whose
    // block time is at or after the moment that cycle's cbBTC came back, and
    // each anchor is consumed so one split cannot vouch for two cycles. An
    // entry with no block time (a pre-round-12 state file) cannot anchor
    // anything, which is the safe direction — it reports rather than assumes.
    const pool = entries.filter(e => !claimed.has(splitSig(e)) && splitTime(e) != null)
      .sort((a, b) => splitTime(a) - splitTime(b))
    const used = new Set()
    const orphans = []
    for (const c of inWindow) {
      const afterMs = Date.parse(c.returnedAt || c.startedAt)
      const hit = pool.find(e => !used.has(splitSig(e)) && splitTime(e) * 1000 >= afterMs - 60_000)
      if (hit) used.add(splitSig(hit)); else orphans.push(c)
    }
    if (orphans.length) {
      out.push({ kind: 'split_by_other_unanchored', severity: S.CRITICAL,
        detail: `${orphans.length} cycle(s) are closed as "someone else split it" with no cbBTC split on chain `
          + `after the cycle's own return to account for them. A cycle closed on the ledger's own word with no `
          + `split behind it is cbBTC that may still be sitting unsplit. First: ${orphans[0].startedAt}` })
    }
  }
  return out
}

/**
 * A vault's reserve going DOWN, not merely below the activation line.
 *
 * `detectDeactivations` only fires under 21,000 sats, so a vault holding a whole
 * bitcoin drained to 21,001 was silent — 99.98% of a customer's Bitcoin, in the
 * one place a resale buyer's entire basis is "this vault still contains its
 * reserve". Balances were not even persisted, so the check could not be written.
 *
 * ROUND 13 — WHAT v5 DID TO THIS DETECTOR. It used to be blind to a legitimate
 * redemption, "which looks identical", to be read against the open/close stamp.
 * There is no stamp any more, and there is no partial redemption either: a thaw
 * must end in a burn, and the burn demands emptiness. So under v5 a LIVE vault's
 * reserve cannot legitimately fall at all — the four routes out of an SPL token
 * account (owner via Execute, a delegate, a close, a burn) each need a thaw, and
 * every thaw ends with the vault destroyed. A drop reported here is now a drop on
 * a vault that SURVIVED it, which no sanctioned path produces.
 *
 * IT IS STILL HIGH AND NOT CRITICAL, FOR ONE REASON: the drop is measured between
 * passes against DAS. A vault redeemed and burned between two passes normally
 * vanishes from the live set and is skipped here (`current[asset] === undefined`)
 * — but if the index lags and still lists it, a perfectly legitimate redemption
 * arrives as a drop. Raising the severity would buy false CRITICALs on index lag,
 * which is the failure this file already refuses to trade for.
 *
 * BLIND TO: a drop and an equal rise between two passes, and to anything at all
 * before the first pass that recorded a balance.
 */
export function detectBalanceDrops(prevBalances, current, opts = {}) {
  const out = []
  if (!prevBalances) return out
  const minDrop = BigInt(opts.minDrop ?? 1)
  for (const [asset, before] of Object.entries(prevBalances)) {
    const after = current[asset]
    if (after === undefined) continue      // covered by the vault-set reconcile
    const b = BigInt(before), a = BigInt(after)
    if (b - a >= minDrop && a < b) {
      out.push({ kind: 'reserve_fell', severity: S.HIGH, asset,
        detail: `vault ${asset} reserve fell ${b - a} base units (${b} -> ${a}). Expected if it was redeemed; otherwise it is the drain the seal exists to prevent.` })
    }
  }
  return out
}

/**
 * The index disagrees with the chain's own count of vaults ever created.
 *
 * `minted_total` is incremented on-chain by `mint_vault` and never decremented,
 * so LIVE + BURNT must equal it. Anything less means the indexer is behind or
 * truncating — and `distribute.mjs` divides the day's cbBTC by the number of
 * ACTIVATED vaults it can see, so a short page does not fail, it OVERPAYS
 * everyone visible and silently omits the rest.
 */
export function detectIndexShortfall(mintedTotal, liveIds, burntIds) {
  const out = []
  if (mintedTotal === undefined || mintedTotal === null) return out
  // COUNT UNIQUE IDS, AND REQUIRE EXACT AGREEMENT.
  //
  // `live.length + burnt.length >= minted_total` accepted a page that repeated
  // ids while omitting real vaults. That is not academic: `distribute.mjs` keys
  // balances by asset id, so duplicates COLLAPSE — 2,100 copies of one vault
  // would satisfy the count and then pay the whole day's cbBTC to that one
  // recipient. Only the mint program can add an asset to the collection, so the
  // unique count must equal `minted_total` exactly; over is as wrong as under.
  // REFUSE THE WRONG SHAPE, LOUDLY. `Array.isArray(x) ? x : []` coerced a NUMBER
  // to an empty set — and both alarm call sites passed `.length` for a whole
  // round, so the completeness check was dead AND the alarm sent a CRITICAL
  // every thirty minutes saying the index had returned zero vaults. Nothing
  // caught it: the selftest calls this function directly with arrays, so the
  // detector was proven in both directions while its WIRING was untested. A
  // silent coercion is how a mis-wired call looks exactly like a real finding.
  if (!Array.isArray(liveIds) || !Array.isArray(burntIds)) {
    throw new TypeError('detectIndexShortfall expects ARRAYS of asset ids, not counts — '
      + `got ${typeof liveIds} and ${typeof burntIds}`)
  }
  const live = new Set(liveIds)
  const burnt = new Set(burntIds)
  const overlap = [...live].filter(a => burnt.has(a))
  if (overlap.length) {
    out.push({ kind: 'index_self_contradictory', severity: S.CRITICAL,
      detail: `${overlap.length} asset(s) are reported as BOTH live and burnt by the collection index. It is not a usable answer.` })
    return out
  }
  const seen = BigInt(live.size + burnt.size)
  const total = BigInt(mintedTotal)
  if (seen !== total) {
    out.push({ kind: 'index_disagrees_with_chain', severity: S.CRITICAL,
      detail: `the collection index returned ${seen} UNIQUE vaults (${live.size} live + ${burnt.size} burnt) but the chain says ${total} have been minted`
        + (seen < total ? '. The index is incomplete; do not distribute or reconcile against it.'
                        : '. Only mint_vault can add to this collection, so more assets than mints means the index is returning something that is not ours.') })
  }
  return out
}

export const SEVERITY = S

/**
 * DOES THE CRON TEMPLATE STILL CARRY THE OS LEASE?
 *
 * `bank/lock.mjs` is a pathname lock and a pathname lock cannot compare-and-swap.
 * Its break has failed in a narrower ordering each round for three rounds; round
 * 15 measured a third runner claiming the pathname during the restore window,
 * with both it and the true holder paying. `flock(2)` on an open fd is the
 * primitive that actually closes it — the kernel holds the lease and releases it
 * when the holder dies — and `scripts/cron-install.sh` now wraps every job in
 * `flock -n`.
 *
 * A PREFIX IN A HEREDOC IS EXACTLY THE KIND OF THING THAT GETS DROPPED IN AN
 * EDIT AND NOTICED BY NOBODY, because the crons keep working — they just stop
 * being exclusive, which is invisible until the day two runs overlap and the
 * ledger pays twice. So it is asserted, against the real file, in the selftest.
 *
 * Returns the offending lines. BLIND TO: whether the installed crontab matches
 * this template. Someone who hand-edits `crontab -e` is outside every control
 * here, which is why the in-process lock stays as well.
 */
export function judgeCronTemplate(text) {
  const bad = []
  // ⚠️ ROUND 16: `-n` IS THE PROPERTY, AND THE FIRST VERSION OF THIS GATE COULD
  // NOT SEE IT. It matched `flock` or `$FLOCK` and nothing else, so
  // `flock /var/lock/x node bank/distribute.mjs` — a WAITING lock — passed. A
  // queued second distribute run pays the same day twice the moment the first
  // finishes, which is the exact bug this whole file exists to prevent. Same
  // class as the litter ternary round 15 fixed: a gate blind to its own subject.
  //
  // `$FLOCK` is accepted only when the variable is DEFINED with `-n` in the same
  // file, so deleting the `FLOCK="$FLOCK -n"` line cannot slip past by being one
  // indirection away.
  const src = String(text)
  const varHasN = /FLOCK="?\$FLOCK\s+-n"?/.test(src) || /FLOCK="?\/usr\/bin\/flock\s+-n"?/.test(src)
  for (const line of src.split('\n')) {
    if (!/^[0-9*]/.test(line)) continue          // not a crontab line
    if (!/node\s+bank\/\S+\.mjs/.test(line)) continue   // not one of our jobs
    if (/\bflock\s+-n\b/.test(line)) continue            // literal, and non-blocking
    if (/\$FLOCK\b/.test(line) && varHasN) continue       // indirect, and the variable carries -n
    bad.push(line.trim())
  }
  return bad
}

/**
 * WHERE DOES THE ELF ACTUALLY START IN A ProgramData ACCOUNT? AT 45. ALWAYS.
 *
 * ROUND 16 WROTE THE FIX FOR THIS AND THEN MEASURED IT AWAY, which is the more
 * useful outcome. Two auditors across two rounds filed `subarray(45)` as a defect
 * — "an IMMUTABLE program's ELF starts at 13, because bincode serializes
 * `Option::None` as one byte" — and that is textbook-correct bincode reasoning
 * about a struct nobody re-serializes from scratch.
 *
 * `bpf_loader_upgradeable::set_authority` rewrites the header INTO THE EXISTING
 * ACCOUNT and never resizes it, and `UpgradeableLoaderState::
 * size_of_programdata_metadata()` is 45 unconditionally. So clearing the
 * authority leaves its 32 bytes in place as garbage and the ELF does not move.
 *
 * MEASURED on two live immutable mainnet programs, Token Metadata and Squads v4:
 * byte 12 is 0, bytes 13..45 are non-zero stale bytes, and `\x7fELF` is at 45.
 * Asserted in `scripts/probe-mainnet-facts.mjs` — a local validator cannot
 * produce an immutable program with a stale authority still in its header, which
 * is precisely why this went unmeasured for two rounds.
 *
 * Had the "fix" shipped, the watch would have folded 32 bytes of stale authority
 * into the fingerprint and fired a spurious CRITICAL on METAPLEX CORE the day
 * Metaplex made it immutable. A plausible finding, accepted without going to the
 * chain, would have broken the most important entry in the drift watch.
 *
 * This function exists so the constant has ONE place and a reason attached to it.
 */
export function readProgramData(data) {
  if (!data || data.length < 45) return { hasAuth: null, elfOffset: null, problem: 'too short to be a ProgramData account' }
  // A TAG THAT IS NEITHER 0 NOR 1 IS MALFORMED, NOT "IMMUTABLE". `data[12] === 1`
  // folded every other byte value into `hasAuth: false`, which the caller renders
  // as the word IMMUTABLE — a confident claim about an account we could not read.
  if (data[12] !== 0 && data[12] !== 1) {
    return { hasAuth: null, elfOffset: 45, problem: `the Option tag at byte 12 is ${data[12]}, which is neither None nor Some` }
  }
  // The offset is NOT conditional. See above — this is the whole point of the file.
  return { hasAuth: data[12] === 1, elfOffset: 45, problem: null }
}



/**
 * DID THIS DAS CALL ACTUALLY ANSWER?
 *
 * ⚠️ THIS EXISTS BECAUSE ROUND 15 FIXED ONE OF TWO IDENTICAL SITES — MINE, in
 * the commit whose own verdict named that as this project's most repeated
 * defect. `cosign.mjs`'s `scanPda` was hardened to fail closed on HTTP status
 * and response SHAPE; `alarm.mjs`'s `listVaults`, one file away, kept
 * `j.result?.items || []`, so a 200 carrying `{}`, `{result:null}` or a provider
 * envelope without `items` read as "this collection contains no vaults".
 *
 * Contained, not harmless: `detectVaultSetChange`'s 10% guard would have fired
 * `vault_index_shrank` at CRITICAL — but `detectNestedVaults` and
 * `detectUndeclaredTokenAccounts`, which ARE the post-hoc half of the control
 * table, would each have reported a clean all-clear over an empty list.
 *
 * So the judgement is ONE function with TWO callers rather than two copies that
 * agree today. A refusal to answer is not an answer, in either file.
 */
export function judgeDasEnvelope({ ok, status, json }) {
  if (!ok) return { items: null, problem: `HTTP ${status}` }
  if (!json || typeof json !== 'object') return { items: null, problem: 'the response is not a JSON object' }
  if (json.error) return { items: null, problem: `RPC error ${JSON.stringify(json.error)}` }
  const items = json.result?.items
  if (!Array.isArray(items)) return { items: null, problem: `no items array (${JSON.stringify(json).slice(0, 160)})` }
  return { items, problem: null }
}


// ═══════════════════════════════ v6 (2026-10-03) ═══════════════════════════════
//
// v6 deleted the Bank, the deck, the distributor wallet and the admin. What the
// off-chain side now owes is narrower and, for the first time, mostly about
// LIVENESS: the programs hold everything, so the failure that matters is a payout
// that silently stops, a reveal queue that silently stalls, or a brake nobody saw
// pulled. Each detector below is pure and proven both ways in bank/selftest.mjs.

/** Our programs' ids, the only ones whose `CBOB_` log lines are believed. */
export const MINT_PROGRAM_ID = 'Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo'
export const BURN_PROGRAM_ID = '8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8'

/**
 * READ THE PROGRAMS' DISTINCT LOG LINES — AND ONLY THE PROGRAMS'.
 *
 * `Program log: CBOB_REDEEMED <asset>` is a string ANY program in a transaction
 * can print. A naive `includes('CBOB_REDEEMED')` would let anyone post a fake
 * redemption to X for the price of a transaction, or bury a real reschedule under
 * fake ones. So a line is attributed to the program on top of the invoke STACK
 * when it was printed (`Program <id> invoke [n]` pushes, `Program <id> success`
 * / `failed` pops), and a CBOB_ line counts only when that program is the one
 * that owns the event: REDEEMED from BURN, everything else from MINT.
 *
 * Returns `{ events, problem }`; an unbalanced stack is a `problem`, never a
 * silent guess about who printed what.
 */
export function parseCbobLogs(logs, ids = { mint: MINT_PROGRAM_ID, burn: BURN_PROGRAM_ID }) {
  const owner = { REDEEMED: ids.burn, DISTRIBUTED: ids.mint, REVEAL_RESCHEDULED: ids.mint, CLAIM_DEFERRED_FROZEN: ids.mint }
  const events = []
  const stack = []
  let problem = null
  for (const line of logs || []) {
    let m
    if ((m = /^Program (\w+) invoke \[(\d+)\]$/.exec(line))) { stack.push(m[1]); continue }
    if ((m = /^Program (\w+) (success|failed.*)$/.exec(line))) {
      if (stack[stack.length - 1] !== m[1]) problem = problem || `unbalanced invoke stack at "${line.slice(0, 80)}"`
      else stack.pop()
      continue
    }
    if (!(m = /^Program log: CBOB_([A-Z_]+)(?: (.*))?$/.exec(line))) continue
    const type = m[1], top = stack[stack.length - 1]
    if (!(type in owner)) continue
    if (top !== owner[type]) continue                  // printed by someone else: not ours
    const kv = {}
    for (const part of (m[2] || '').split(' ')) {
      const eq = part.indexOf('=')
      if (eq > 0) kv[part.slice(0, eq)] = part.slice(eq + 1)
      else if (part) kv._ = part
    }
    if (type === 'REDEEMED') events.push({ type, asset: kv._ ?? null })
    else if (type === 'DISTRIBUTED') events.push({ type, amount: kv.amount ?? null, path: kv.path ?? null })
    else if (type === 'REVEAL_RESCHEDULED') events.push({ type, asset: kv.asset ?? null, mintIndex: kv.mint_index ?? null,
      oldSlot: kv.old_slot ?? null, newSlot: kv.new_slot ?? null, times: kv.times ?? null })
    else if (type === 'CLAIM_DEFERRED_FROZEN') events.push({ type, asset: kv.asset ?? null, owed: kv.owed_sats ?? null })
  }
  return { events, problem }
}

/**
 * Turn the programs' events into findings. RESCHEDULED and DEFERRED_FROZEN each
 * happen ONCE per occurrence, so they are `urgent` (ALERT_URGENT, bypassing the
 * alert router's recovery buffer, which assumes a watchdog re-asserts while its
 * condition is true; these do not).
 */
export function detectProgramEvents(events, sig = null) {
  const out = []
  for (const e of events || []) {
    if (e.type === 'REVEAL_RESCHEDULED') out.push({ kind: 'reveal_rescheduled', severity: S.HIGH, urgent: true, asset: e.asset,
      detail: `vault ${e.asset} (mint #${e.mintIndex}) missed its level-draw window and was RESCHEDULED (slot ${e.oldSlot} -> ${e.newSlot}, ${e.times} time(s)). The crank and every protocol transaction capture entropy; a lapse means all of them were absent for the whole window. It also hands that minter one re-roll (accepted limit 25). Tx ${sig || '?'}` })
    else if (e.type === 'CLAIM_DEFERRED_FROZEN') out.push({ kind: 'claim_deferred_frozen', severity: S.HIGH, urgent: true, asset: e.asset,
      detail: `vault ${e.asset}'s cbBTC account is FROZEN (cbBTC's freeze authority is Coinbase), so its payout of ${e.owed} sats was deferred. It stays owed in full; nothing was lost or redistributed. Tx ${sig || '?'}` })
    else if (e.type === 'DISTRIBUTED') out.push({ kind: 'distributed', severity: S.INFO,
      detail: `a distribution credited ${e.amount} sats to the activated vaults (path ${e.path}). Tx ${sig || '?'}` })
    else if (e.type === 'REDEEMED') out.push({ kind: 'redeemed', severity: S.INFO, asset: e.asset,
      detail: `vault ${e.asset} was redeemed and burned. Tx ${sig || '?'}` })
  }
  return out
}

const big = v => (v === undefined || v === null) ? null : BigInt(v)

/**
 * THE MONTHLY PAYOUT DID NOT HAPPEN. Three layers each run it (the crank, every
 * protocol transaction once due, and anyone for free); this is the page that says
 * all three were absent. Due only when there is someone to pay and something to
 * pay them: no activated vault, or nothing undistributed in the pool, is not late.
 */
export function detectDistributionOverdue(cur, { nowSec, poolAvail, graceSecs = 6 * 3600 } = {}) {
  const last = big(cur['mint.last_distribute_at']), period = big(cur['mint.monthly_secs'])
  const w = big(cur['mint.total_active_weight'])
  if (last === null || period === null || w === null || nowSec === undefined) return []
  // ── ROUND 22 (A4): THE TWO STALLS THE REST OF THIS FUNCTION CANNOT SEE ──
  const pc = big(cur['mint.pending_count']), pt = big(cur['mint.pending_this_epoch'])
  const stalls = []
  if (pc !== null && pt !== null) {
    const eligible = pc - pt
    // Vaults eligible to join hold EVERY distribution until they are joined. The
    // crank joins them each pass; this long after the last distribution means
    // nobody did.
    if (eligible > 0n && BigInt(nowSec) - last > BigInt(graceSecs)) stalls.push({ kind: 'joins_stalled', severity: S.HIGH,
      detail: `${eligible} vault(s) became eligible to join at the last distribution (unix ${last}) and are still not joined. Until they are, NO distribution can run. The crank should have joined them; anyone can, free (a \`claim\` naming them).` })
    // Nobody joined yet and some asked: the free monthly run is what lets them in.
    if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL,
      detail: `${pt} vault(s) have asked to activate and NOBODY is on the payout schedule, but the free monthly run that lets them join has not happened (due unix ${last + period}). Anyone can run it free: \`distribute(false)\`.` })
  }
  if (w === 0n) return stalls
  if (poolAvail === null || poolAvail === undefined || BigInt(poolAvail) <= 0n) return stalls
  const due = last + period
  const late = BigInt(nowSec) - due
  if (late <= BigInt(graceSecs)) return stalls
  return [...stalls, { kind: 'distribution_overdue', severity: S.CRITICAL,
    detail: `no distribution for ${(BigInt(nowSec) - last) / 3600n}h: it was due at unix ${due} and is ${late / 3600n}h late, with ${poolAvail} sats undistributed and ${cur['mint.active_count'] ?? '?'} vault(s) waiting. The crank, the in-line monthly run and the free public call all failed to happen. Anyone can run it free now: \`distribute(false)\`.` }]
}

/**
 * THE POOL ITSELF. `tok` is bank/spl.mjs's reading of the pool account plus the
 * raw `state` byte (offset 108). An absent, foreign or malformed pool after
 * initialize is a fault; a FROZEN pool (Coinbase holds cbBTC's freeze authority,
 * accepted limit 28) stops every claim; and a pool holding LESS than it owes
 * should be impossible by construction, so it is the loudest finding here.
 */
export function detectPoolHealth(cur, tok) {
  if (!tok) return []
  const out = []
  if (tok.state !== 'ok') {
    out.push({ kind: 'pool_unreadable', severity: S.CRITICAL,
      detail: `the community pool account reads as ${tok.state}. It holds every distributed-but-undelivered sat; nothing can be claimed until it is a live cbBTC account again.` })
    return out
  }
  if (tok.frozen) {
    out.push({ kind: 'pool_frozen', severity: S.CRITICAL, urgent: true,
      detail: 'the community pool\'s cbBTC account is FROZEN. Every claim refuses until it is thawed, and only cbBTC\'s freeze authority (Coinbase) can thaw it. Nothing on Solana can prevent or undo this.' })
  }
  const owed = big(cur['mint.owed_scaled'])
  if (owed !== null) {
    const owedCeil = (owed + 999_999_999_999n) / 1_000_000_000_000n
    if (BigInt(tok.amount) < owedCeil) out.push({ kind: 'pool_insolvent', severity: S.CRITICAL,
      detail: `the pool holds ${tok.amount} sats but owes ${owedCeil}. The program never distributes what it does not hold, so this means value left the pool by a path the code says does not exist.` })
  }
  return out
}

/** The pool's undistributed balance, exactly as the program computes it. */
export function poolAvailable(cur, poolAmount) {
  const owed = big(cur['mint.owed_scaled'])
  if (owed === null || poolAmount === null || poolAmount === undefined) return null
  const owedCeil = (owed + 999_999_999_999n) / 1_000_000_000_000n
  const a = BigInt(poolAmount) - owedCeil
  return a > 0n ? a : 0n
}

/**
 * HOW MANY REDEMPTIONS THE ROLLING WINDOW STILL HAS ROOM FOR RIGHT NOW. The
 * arithmetic is BURN's (stage 3c): cap = max(1, ceil(live x 210 / 10,000)),
 * bounded by the 64-slot ring; a redemption lands iff the cap-th most recent one
 * is at least a window old. So the room left is the cap minus the redemptions
 * the ring holds inside the last window.
 */
export const RATE_RING = 64
export function redemptionCapacity(cur, nowSec) {
  const minted = big(cur['mint.minted_total']), burned = big(cur['burn.burned_total'])
  const bare = big(cur['mint.bare_burns_retired']), window = big(cur['burn.redeem_window_secs'])
  const ring = cur['burn.rate_ring']
  if ([minted, burned, bare, window].some(v => v === null) || window <= 0n) return null
  if (!Array.isArray(ring) || ring.length !== RATE_RING) return null
  const live = minted - burned - bare
  if (live < 0n) return null
  let cap = (live * 210n + 9_999n) / 10_000n
  if (cap < 1n) cap = 1n
  if (cap > BigInt(RATE_RING)) cap = BigInt(RATE_RING)
  const now = BigInt(nowSec)
  const inWindow = BigInt(ring.filter(t => now - BigInt(t) < window).length)
  return { live, cap, remaining: cap > inWindow ? cap - inWindow : 0n }
}

/** Page when the 2.1% window is nearly full: either a rush, or someone (a thief
 *  with leaked keys, accepted limit 32) spending it. Either way a human looks. */
export function detectRedemptionRate(cur, nowSec, { nearFraction = 0.2 } = {}) {
  const c = redemptionCapacity(cur, nowSec)
  if (!c) return []
  // An idle window is never "near the cap" (round 22, A3: at 47 or fewer live
  // vaults the cap is 1, and the 20% band paged HIGH on an empty hour).
  if (c.remaining >= c.cap) return []
  const near = BigInt(Math.max(1, Math.floor(Number(c.cap) * nearFraction)))
  if (c.remaining > near) return []
  return [{ kind: 'redemptions_near_cap', severity: S.HIGH,
    detail: `${c.remaining} of ${c.cap} redemption(s) left in this window (2.1% of ${c.live} live vaults). Either holders are rushing for the exit or someone is spending the budget. If Gary Club wallet keys are suspect, this window is the time to move custodial vaults to fresh keys — a transfer is not rate-limited.` }]
}

/** MINT-PRICE cbBTC SITTING UNSPLIT (round 22, S1). The crank splits it each
 *  pass; hours of it waiting means nobody did, and holders are not credited. */
export function detectUnsplitRevenue({ amount, sinceSec, nowSec, graceSecs = 6 * 3600 } = {}) {
  if (!(BigInt(amount ?? 0) > 0n) || sinceSec === null || sinceSec === undefined) return []
  if (BigInt(nowSec) - BigInt(sinceSec) <= BigInt(graceSecs)) return []
  return [{ kind: 'revenue_unsplit', severity: S.HIGH,
    detail: `${amount} sats of cbBTC have sat in the revenue address since unix ${sinceSec} without being split 85/15. The crank splits it each pass; anyone can (\`split_revenue\`, permissionless).` }]
}

/** A VAULT RESERVE ACCOUNT FROZEN (round 22, F6). Only cbBTC has a live freeze
 *  authority (Coinbase). A frozen account blocks that vault's claims (cbBTC) and
 *  its WHOLE redemption, because BURN requires every reserve account empty and a
 *  frozen account cannot be emptied. Nothing on Solana can undo it. */
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault,
    detail: `vault ${vault}'s ${isPayment ? 'cbBTC' : mint} account is FROZEN. ${isPayment ? 'Its payouts stay owed and are deferred, and ' : ''}it cannot be redeemed until the freeze authority thaws it. Nothing on Solana can prevent or undo this; tell the holder.` }]
}

/**
 * THE LEVEL QUEUE STOPPED (round 22, A4). A level is drawn seconds after a mint by
 * the crank or by ordinary traffic; a queue that has not moved between two passes
 * (30 minutes) while vaults wait means nobody captured, rescheduled or revealed,
 * which no log line can report because nothing ran.
 */
export function detectRevealStall(prev, cur) {
  if (!prev) return []
  const m0 = big(prev['mint.minted_total']), r0 = big(prev['mint.revealed_total'])
  const m1 = big(cur['mint.minted_total']), r1 = big(cur['mint.revealed_total'])
  if ([m0, r0, m1, r1].some(v => v === null)) return []
  if (!(r0 < m0 && r1 < m1 && r1 === r0)) return []
  return [{ kind: 'reveal_queue_stalled', severity: S.HIGH,
    detail: `${m1 - r1} vault(s) are waiting for their level and the queue has not moved since the last pass (still at mint index ${r1}). The crank's reveal lane is down or failing; anyone can capture, reschedule and reveal.` }]
}

/** The guardian's brake: the PULL and the RELEASE, each paged once, URGENT. */
export function detectBrakeTransitions(prev, cur) {
  if (!prev) return []
  const out = []
  for (const [k, what] of [['mint.sales_stopped', 'SALES'], ['mint.sweep_stopped', 'THE SOL SWEEP']]) {
    const a = prev[k], b = cur[k]
    if (a === undefined || b === undefined || a === b) continue
    if (b === true) out.push({ kind: 'brake_pulled', severity: S.CRITICAL, urgent: true,
      detail: `the guardian STOPPED ${what}. Only a governance vote can restart it. Redemption, activation, distribution and claims are unaffected.` })
    else out.push({ kind: 'brake_released', severity: S.HIGH, urgent: true,
      detail: `${what} RESTARTED. Only a governance vote can do that, so a proposal has executed — check it is one the holders voted for.` })
  }
  return out
}

/**
 * THE LOCK DATE. v6 is made immutable at launch (Gary, 2026-10-03). Before the
 * date written in `CBOB_LOCK_DEADLINE` an upgrade authority is expected (the
 * deploy needs it); after it, any of our four programs still upgradeable is a
 * standing CRITICAL every pass, because whoever holds that key can rewrite every
 * rule this system promises — and its holders were told nobody can.
 */
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  // ROUND 22 (A5): NOTHING SET THE DEADLINE, so this never ran. In production, a
  // deployed program of ours that is still upgradeable with NO deadline on record
  // is itself the finding.
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL,
      detail: `${live.join(', ').toUpperCase()} ${live.length > 1 ? 'are' : 'is'} deployed and still upgradeable, and no lock deadline is set (launch/mainnet-init.json lock_deadline). Holders were told nobody can change the rules.` }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL,
      detail: `the ${p.toUpperCase()} program is STILL UPGRADEABLE by ${v}, past the launch-lock date (unix ${lockDeadlineSec}). Holders were told nobody can change the rules. Remove the upgrade authority (\`solana program set-upgrade-authority --final\`).` })
  }
  return out
}
