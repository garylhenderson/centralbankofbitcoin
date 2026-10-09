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
/** Round 23 (L13): the Proof of Burn collection the launch gate pins was missing
 *  from the alarm's production list. One constant, both readers. */
export const POB_COLLECTION = 'F9TDm35JQYZEB1zBPJG2HRTFM3M4ukjuLTMGhk13hsnT'
/** THE $CBOB mint, created on mainnet 2026-10-04 with no mint and no freeze
 *  authority. Same constant in the alarm and the launch gate. */
export const CBOB_MINT = 'GMm2yY2z333tMkDSHTxNGuxNzr196XgWVCgr3odSKaXc'

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

/** ROUND 25 (I2): the third-party programs the swap needs, watched like Core
 *  (never "not deployed": a missing ProgramData is a value, `NO_PROGRAMDATA`).
 *  The ids are bank/swap.mjs's pins, asserted equal in bank/selftest.mjs. */
export const THIRD_PARTY_PROGRAMS = [
  ['orca', 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', 'Orca Whirlpool'],
  ['meteora', 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', 'Meteora DLMM'],
  ['pyth_receiver', 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ', 'Pyth receiver'],
  ['pyth_push', 'pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT', 'Pyth push-oracle'],
]
const THIRD_PARTY_KEYS = new Set(THIRD_PARTY_PROGRAMS.flatMap(([n]) => [`prog.${n}.upgrade_authority`, `prog.${n}.hash`]))

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
    // the $CBOB boost (2026-10-04): which mint buys one, and the bounds no vote may pass
    ['mint.cbob_mint', S.CRITICAL, 'THE $CBOB mint a boost burns — fixed forever'],
    ['mint.max_boost_weight', S.CRITICAL, 'the largest extra weight a vote may give a boost — fixed forever'],
    ['mint.max_boost_epochs', S.CRITICAL, 'the most distributions a vote may let a boost last — fixed forever'],
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
    ['mint.boost_price', S.HIGH, 'THE $CBOB A BOOST BURNS (a vote changed it; 0 = boosts off)'],
    ['mint.boost_weight', S.HIGH, 'the extra weight a boost buys (a vote changed it)'],
    ['mint.boost_epochs', S.HIGH, 'how many distributions a boost lasts (a vote changed it)'],
    ['gov.last_boost_id', S.HIGH, 'a boost-terms proposal has executed'],
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
    ['prog.sweep.upgrade_authority', S.CRITICAL, 'can replace the SWEEP helper every redemption calls'],
    ['prog.sweep.hash', S.CRITICAL, 'THE DEPLOYED SWEEP HELPER BYTES CHANGED'],
    ['prog.core.upgrade_authority', S.CRITICAL, 'can replace METAPLEX CORE, which every vault rests on'],
    ['prog.core.hash', S.CRITICAL, 'THE DEPLOYED METAPLEX CORE BYTES CHANGED — every seal, thaw, sweep and burn is a CPI into it'],
    // ROUND 25 (I2): THE FOUR THIRD-PARTY PROGRAMS THE ROYALTY SWAP RESTS ON. All
    // four are upgradeable by keys that are not ours (measured 2026-10-05), so a
    // change is news; HIGH, not CRITICAL, because their upgrades are routine and
    // the swap's oracle floor and post-swap delta check still bound what one can do.
    ...THIRD_PARTY_PROGRAMS.flatMap(([n, , what]) => [
      [`prog.${n}.upgrade_authority`, S.HIGH, `can replace the ${what} program, which the royalty swap trades through`],
      [`prog.${n}.hash`, S.HIGH, `THE DEPLOYED ${what.toUpperCase()} BYTES CHANGED (the royalty swap trades through it; re-run sim/swap-fork.sh)`]]),
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
  'mint.boosts_active', 'mint.boosts_due',
  'mint.sales_stopped', 'mint.sweep_stopped', 'mint.guardian',
  // Round 23 (I3): `detectRevealStall` reads the first and the report prints the
  // second, and neither was on this list, so a reader that dropped them read as
  // a queue that never stalls.
  'mint.revealed_total', 'mint.active_count',
  // Round 33 (D2): the only chain input of the round-32 sweep backstop, which
  // reads an absent key as "never swept" and stays quiet.
  'mint.last_sweep_at',
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

/** The `_missing` flag that says key `k`'s program was not deployed when a
 *  snapshot was read: `prog.<p>.x` -> `prog.<p>._missing`; the two collection
 *  hashes exist exactly when MINT does (see `missingWatchedKeys`). */
const missingFlagOf = k => {
  const [p, q] = k.split('.')
  if (p === 'prog') return `prog.${q}._missing`
  return `${p === 'collection' || p === 'pob_collection' ? 'mint' : p}._missing`
}

export function detectConfigDrift(prev, cur) {
  const out = []
  if (!prev) return out
  const watch = WATCH

  for (const [k, severity, why] of watch) {
    // ROUND 23 (L11): A PROGRAM APPEARING IS NOT A RULE CHANGING. The first pass
    // after each `initialize` read every fixed-forever value as drift from null
    // (39 findings, 27 CRITICAL, "a vote replaced it"), which teaches the reader
    // to scroll past exactly the page that one day matters. Skipped ONLY when the
    // previous snapshot recorded that program as ABSENT and held no value for the
    // key: Core is never absent-and-null (`NO_PROGRAMDATA` is a value), and a key
    // that was null while its program was present still drifts.
    if ((prev[k] === undefined || prev[k] === null) && prev[missingFlagOf(k)] === true) continue
    // ROUND 25 (I2): a third-party program's keys entering the watch is not that
    // program changing. A baseline from before round 25 never recorded them
    // (`undefined`, not null); once recorded, the baseline carries them forward.
    if (prev[k] === undefined && THIRD_PARTY_KEYS.has(k)) continue
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
      // Gary 2026-10-04: the $CBOB boost's ceilings.
      ['mint.max_boost_weight', 12, 'the largest extra weight a vote may give a boost (12)'],
      ['mint.max_boost_epochs', 24, 'the most distributions a vote may let a boost last (24)'],
      ['mint.cbob_mint', CBOB_MINT, 'THE $CBOB mint (created 2026-10-04, no mint or freeze authority)'],
      // Round 23 (L13): the launch gate pinned it and this list did not.
      ['mint.pob_collection', POB_COLLECTION, 'the Proof of Burn collection (Giraffish Moments)'],
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
  // is closed. Without this a refusal (`SweepTooSoon`, `SweepAboveCap`, a sweep
  // that failed on chain or expired unlanded, round 25 L3) wedges every future
  // run AND raises a CRITICAL about lamports that never left.
  if (c?.sendRejected) return false
  if (moved === 0n) return false
  // A cycle is not finished when the cbBTC comes back; it is finished when the
  // cbBTC has been SPLIT. Money sitting unsplit in the revenue ATA is money the
  // holders have not been paid, and treating the return as the end let a failed
  // `split_revenue` look like a completed cycle.
  return BigInt(c?.returnedSats ?? 0) === 0n || !(c?.splitSig || c?.splitByOther)
}

/**
 * ROUND 24 (L10d): WHEN A CYCLE REALLY STARTED. `startedAt` is written by the
 * process that holds the operator key, and every grace window here was measured
 * from it, so a row stamped far in the FUTURE stayed "in flight" for as long as
 * its writer liked. The sweep's own block time (the chain-derived `sweeps` the
 * alarm keeps) caps it, and a start that is still in the future, or no date at
 * all, is not graced: a false timestamp is itself a reason to look.
 */
export function cycleStartMs(c, sweeps = [], nowMs = Date.now(), chainNowMs = null) {
  let t = Date.parse(c?.startedAt)
  const hit = (sweeps || []).find(e => e && e.sig && e.sig === c?.sweepSig && e.blockTime !== null && e.blockTime !== undefined)
  // A supplied chain clock makes the confirmed sweep authoritative. Translate
  // its age into the caller's wall-clock domain, never compare the two clocks.
  if (hit && chainNowMs !== null) {
    const at = Number(hit.blockTime) * 1000
    return Number.isFinite(at) && at > 0 && at <= chainNowMs ? nowMs - (chainNowMs - at) : -Infinity
  }
  if (hit) t = Number.isFinite(t) ? Math.min(t, Number(hit.blockTime) * 1000) : Number(hit.blockTime) * 1000
  return Number.isFinite(t) && t <= nowMs ? t : -Infinity
}

/**
 * ROUND 24 (L10b, L11): THE SPLIT THAT DIVIDED A CYCLE'S RETURN, read off the
 * chain. `split_revenue` moves the WHOLE revenue balance, so the first cbBTC
 * split at or after a cycle's return carries at least what came back. That is
 * the anchor round 23 (L16) gave `splitByOther`; it is now also what an explicit
 * `splitSig` is held to, and what closes a cycle whose split landed but was never
 * recorded (a crash between split and save, or a front-run while mints refilled
 * the account), in the alarm AND in `revenue.mjs`'s recovery, one predicate for
 * both. `exclude` holds signatures other cycles already claim; `upTo` bounds the
 * search to splits no later than a claimed one. Returns the entry, or null.
 *
 * ROUND 25 (I1): ANCHORED ON THE RETURN'S BLOCK TIME when the row carries it
 * (`returnBlockTime`, read off the chain from `returnSig`). The anchor used to be
 * the box's `returnedAt` less 60 s of slack for clock skew, so a mint-revenue
 * split landing up to a minute BEFORE our return could be recorded as this
 * cycle's split, leaving our cbBTC unsplit until the next hour. Both times are
 * the chain's now, so no slack is needed. A row without it (written before this
 * field, or with the block time unreadable) keeps the old slack.
 */
// ROUND 34 (L1): the deduped, time-sorted view of a split list, computed ONCE per
// list (keyed by the array and its length) instead of once per cycle. A
// stranger can add a split for one fee and one sat, and the per-pass cost had
// grown as cycles x splits (34 s at 1,460 cycles and 100,000 splits).
const SORTED_SPLITS = new WeakMap()
function sortedSplits(splits) {
  const hit = SORTED_SPLITS.get(splits)
  if (hit && hit.len === splits.length) return hit.list
  const list = dedupeSeenSplits(splits).filter(e => splitTime(e) !== null && splitTotal(e) !== null)
    .sort((a, b) => splitTime(a) - splitTime(b))
  if (splits && typeof splits === 'object') SORTED_SPLITS.set(splits, { len: splits.length, list })
  return list
}

export function closesCycle(c, splits = [], { exclude = new Set(), upTo = null } = {}) {
  let need = 0n
  try { need = BigInt(c?.returnedSats ?? 0) } catch { return null }
  if (need <= 0n) return null
  const anchor = Number(c?.returnBlockTime)
  const anchored = c?.returnBlockTime !== null && c?.returnBlockTime !== undefined && Number.isFinite(anchor) && anchor > 0
  const afterMs = Date.parse(c?.returnedAt || c?.startedAt)
  if (!anchored && !Number.isFinite(afterMs)) return null
  const atOrAfter = e => anchored ? splitTime(e) >= anchor : splitTime(e) * 1000 >= afterMs - 60_000
  // The same predicate as ever, applied from the first split that can satisfy
  // it (binary search on the sorted view), in time order, to the first large
  // enough one; identical results, proven against the old form in selftest.
  const list = sortedSplits(splits)
  let lo = 0, hi = list.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (atOrAfter(list[mid])) hi = mid; else lo = mid + 1 }
  for (let i = lo; i < list.length; i++) {
    const e = list[i]
    if (upTo !== null && splitTime(e) > upTo) break
    if (exclude.has(splitSig(e))) continue
    if (splitTotal(e) >= need) return e
  }
  return null
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
  const claimedSigs = new Set((ledger.cycles || []).map(c => c?.splitSig).filter(Boolean))
  for (const c of (ledger.cycles || [])) {
    const age = nowMs - cycleStartMs(c, opts.sweeps, nowMs, opts.chainNow ?? null)
    const swept = BigInt(c.sweptLamports || c.intendedLamports || 0)
    // ROUND 24 (L10a): A REJECTED ROW THAT MOVED MONEY. `revenue.mjs` marks a row
    // `sendRejected` only when the program refused the sweep, and then never
    // writes `sweepSig` or `sweptLamports`. A row carrying both says SOL left and
    // also that nothing did, and `cycleIsOpen` believes the second half, which
    // quieted all three detectors below. The contradiction is the finding.
    if (c.sendRejected && (c.sweepSig || c.sweptLamports)) {
      out.push({ kind: 'rejected_row_has_sweep', severity: S.CRITICAL,
        detail: `cycle ${c.startedAt} is marked as a REFUSED sweep but records ${c.sweepSig ? `sweep ${c.sweepSig}` : ''}${c.sweptLamports ? ` ${c.sweptLamports} lamports swept` : ''}. revenue.mjs never writes both, and the refusal flag closes the cycle: this is a ledger that hides a sweep.` })
      continue
    }
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
    // Round 24 (L10d): a return stamped in the future is not graced either.
    const rtMs = Date.parse(c.returnedAt || c.startedAt)
    const sinceReturn = nowMs - (Number.isFinite(rtMs) && rtMs <= nowMs ? rtMs : -Infinity)
    // ROUND 24 (L11): CLOSED ON CHAIN EVIDENCE. A split that landed with no
    // ledger row (a crash before the save, or a stranger's split) paged this HIGH
    // for ever, because it waited for the ledger. A seen split at or after the
    // return, at least as large as it, and claimed by no other cycle IS the split.
    const closedOnChain = returned > 0n && !c.splitSig && !c.splitByOther
      && closesCycle(c, opts.splits || [], { exclude: claimedSigs }) !== null
    if (returned > 0n && !c.splitSig && !c.splitByOther && !closedOnChain && sinceReturn >= graceMs) {
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
/** ROUND 34 (L2): the quantity the reconcile page states for a token account a
 *  vault owns, from the account's own owner program. The money paths' reader
 *  answers a confident 0 for anything not classic Token, which is right there and
 *  wrong here: a Token-2022 balance is read from the same base field and labelled
 *  (a confidential balance is not in it), and an unreadable one says so. */
export function reconcileAmount(ownerProgram, data) {
  if (!data || data.length < 72) return 'unreadable'
  if (ownerProgram === TOKEN_ID) return String(data.readBigUInt64LE(64))
  if (ownerProgram === TOKEN22_ID) return `${data.readBigUInt64LE(64)} units in the Token-2022 base field, any confidential balance not included`
  return 'unreadable'
}

export function detectUndeclaredTokenAccounts(asset, expectedAtas, owned) {
  const out = []
  const expected = new Set(expectedAtas)
  for (const { address, amount } of owned) {
    if (expected.has(address)) continue
    out.push({ kind: 'undeclared_token_account', severity: S.CRITICAL, asset,
      detail: `vault ${asset} owns token account ${address} (${/^\d+$/.test(String(amount)) ? `${amount} units` : amount}) that is NOT a canonical reserve ATA. burn_vault checks only DECLARED accounts, so this balance is destroyed with the vault unless someone declares it. The holder must declare it in their redemption, or it is lost.` })
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
// ROUND 36 (L4): nested_vault and vault_owns_itself are no longer ackable. Since
// item 58 both have an action (rescue_nested), so muting one hides work owed.
export const ACKABLE_KINDS = new Set(['unredeemable_owner'])

/**
 * ROUND 32 (L1): A SWEEP JUDGED FROM ACCOUNT STATE, which no flood can delay.
 * `unledgered_sweep` comes only from the MINT transaction walk, and a stranger
 * can delay that walk by flooding MINT; an off-box thief holding the operator key
 * could sweep in the meantime. MINT writes `last_sweep_at` (the chain clock) on
 * every sweep, so each pass compares it with the time already judged: a newer
 * one, once older than the grace (time for revenue.mjs to save its row), must be
 * explained by a ledger cycle that recorded a sweep (confirmed, or uncertain
 * and shown LANDED by a direct status lookup) whose start is within half a
 * cooldown of it, or it pages CRITICAL. There is no baseline-only first pass:
 * a missing `judgedThrough` is 0 (review 32), so the first pass judges too.
 * Returns `{ findings, judged }`; `judged` is the new baseline. (Round 38 C02:
 * this comment used to say "within an hour" and "the first pass only takes the
 * baseline", neither of which the code does.)
 */
export function detectSweepState({ judgedThrough, lastSweepAt, ledger, nowSec, cooldownSecs = 21600, graceSecs = 900, landed = new Set() }) {
  const t = Number(lastSweepAt ?? 0)
  // Review 32: MINT's `initialize` writes 0, so a missing baseline is 0, never
  // "adopt whatever is there now" (that silently accepted the first sweep seen).
  const from = Number(judgedThrough ?? 0)
  if (!(t > from)) return { findings: [], judged: from }
  if (Number(nowSec) - t < graceSecs) return { findings: [], judged: from }
  // ROUND 33 (L1, D1): `startedAt` is the box's wall clock and `t` the chain's,
  // so the window must tolerate skew: |t - start| <= cooldown/2. It cannot be
  // fooled by an honest cycle whose sweep LANDED: a thief's next legal sweep is a
  // full cooldown after it, and revenue.mjs writes a cycle row only once the
  // cooldown has passed, so either way the gap exceeds cooldown/2. An uncertain
  // send (`pendingSweepSig` only) explains a sweep ONLY if the caller's direct
  // signature lookup (`landed`, not floodable) confirms it landed; an honest
  // send that never landed explains nothing.
  const half = Math.floor(Number(cooldownSecs) / 2)
  const explained = (ledger?.cycles || []).some(c => {
    if (!(c.sweepSig || (c.pendingSweepSig && landed.has(c.pendingSweepSig)))) return false
    const st = Date.parse(c.startedAt) / 1000
    return Number.isFinite(st) && Math.abs(t - st) <= half
  })
  return { judged: t, findings: explained ? [] : [{ kind: 'sweep_unledgered_state', severity: S.CRITICAL,
    detail: `MINT's last_sweep_at moved to ${new Date(t * 1000).toISOString()}: a sweep of royalty SOL landed, and no revenue-ledger cycle that recorded a landed sweep started within half a cooldown of it. This is read from account state and cannot be delayed by flooding the transaction scan. If the revenue job crashed between sending a sweep and saving its signature, its row will show the attempt; otherwise the swap operator key is being used by someone else, and the guardian can stop the sweep (emergency_stop_sweep).` }] }
}

/**
 * ROUND 31 (L1, after review): THE TRUNCATION GAP IS A LEVEL CONDITION THAT
 * ONLY A PERSON CLEARS. Each transaction in which one of our programs ran with
 * runtime-truncated logs is kept in `logGaps` (in the order the walk met them;
 * unreviewed entries are never dropped, the reviewed prefix is trimmed). The
 * finding stands, with text free of signatures and counts, on every pass while
 * any kept gap is newer than the reviewed-through watermark a human writes after
 * inspecting them; so the stream opens once, more gaps (a stranger buying them
 * for a fee each) add no email, and it recovers only after review. A watermark
 * that is not among the kept gaps leaves every kept gap unreviewed, the loud
 * direction. Returns `{ findings, keep }`.
 */
export function detectLogGaps(prevGaps, newGaps, reviewedThrough) {
  // A Set, not indexOf: the list is no longer capped below the watermark, and an
  // O(n^2) dedupe let a paid gap flood slow every pass (review 32).
  const all = [...new Set([...(prevGaps || []), ...(newGaps || [])].filter(g => typeof g === 'string'))]
  const at = reviewedThrough ? all.indexOf(reviewedThrough) : -1
  const unreviewed = at >= 0 ? all.slice(at + 1) : all
  // ROUND 32 (L3): AN UNREVIEWED GAP IS NEVER EVICTED. Only the reviewed prefix
  // is trimmed (to 500 in all, keeping the watermark itself), so 500 cheap
  // gaps can no longer push a genuine one out before anyone saw it. A flood of
  // unreviewed gaps escalates instead, once, to CRITICAL with its own text.
  const reviewed = at >= 0 ? all.slice(0, at + 1).slice(-Math.max(1, 500 - unreviewed.length)) : []
  const keep = [...reviewed, ...unreviewed]
  if (!unreviewed.length) return { keep, findings: [] }
  const flooded = unreviewed.length > 2000
  return { keep, findings: [{ kind: 'log_coverage_gap', severity: flooded ? S.CRITICAL : S.HIGH,
    detail: (flooded ? 'MORE THAN 2,000 unreviewed transactions in which our programs ran have runtime-truncated logs: someone is padding transactions, possibly to bury one that lost a real event line. ' : '')
      + 'transactions in which our programs ran have runtime-truncated logs: their CBOB event lines (a level-draw reschedule, a frozen-claim deferral, a frozen-pool forfeit) may be missing and were NOT read; their instructions and token movements WERE checked and the scan moved past them. Anyone can cause this for one fee by padding a transaction. The signatures are the alarm state\'s logGaps; none after the reviewed-through watermark is ever dropped. Inspect every entry after the watermark by hand, then write the LAST signature listed in logGaps to the watermark file to clear this.' }] }
}

/**
 * ROUND 43 (V43o-2): A SIGNATURE THAT STAYS UNREADABLE IS SKIPPED, ON THE RECORD.
 * The alarm holds a program's cursor over an unreadable transaction so the next
 * pass retries it (round 32, L2), which assumed the fault was transient. A
 * permanent one (an RPC that always answers that signature malformed, or a
 * transaction version this reader does not know) froze the cursor and any
 * backlog for good, so every newer transaction on that program went unread.
 * After UNREADABLE_SKIP_PASSES consecutive passes the walk moves past it and
 * keeps it here, a LEVEL condition only a person clears, with the same keeping
 * rule as the truncation gap (`detectLogGaps`: an unreviewed entry is never
 * dropped). Returns `{ findings, keep }`.
 */
export const UNREADABLE_SKIP_PASSES = 3
export function detectUnreadSkips(prevSkips, newSkips, reviewedThrough) {
  const g = detectLogGaps(prevSkips, newSkips, reviewedThrough)
  return { keep: g.keep, findings: g.findings.map(f => ({ kind: 'tx_skipped_unreadable', severity: f.severity,
    detail: (f.severity === S.CRITICAL ? 'MORE THAN 2,000 unreviewed transactions on our programs were skipped as unreadable: the RPC or the transaction format has changed under the alarm. ' : '')
      + `transactions on our programs could not be read on ${UNREADABLE_SKIP_PASSES} consecutive passes, so the scan moved past them to keep reading newer ones: their instructions, token movements and CBOB event lines were NOT examined. The signatures are the alarm state's unreadSkips; none after the reviewed-through watermark is ever dropped. Read every entry after the watermark by hand (another RPC, an explorer), then write the LAST signature listed in unreadSkips to the watermark file to clear this.` })) }
}

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
  vault_burned: a => `vault ${a} was REDEEMED: burn_vault ran on it in a successfully scanned transaction, so the emptiness proof ran. Anything undeclared is still orphaned — that is what the nested-vault and undeclared-account detectors are for.`,
  vault_vanished: a => `vault ${a} is no longer readable because it was REDEEMED and burned, not because it went dark. burn_vault ran on it in a successfully scanned transaction.`,
  deactivated: a => `vault ${a} fell below activation because it was REDEEMED and burned in a successfully scanned transaction. The index is one pass behind.`,
  reserve_fell: a => `vault ${a}'s reserve fell because it was REDEEMED and burned in a successfully scanned transaction. The index is one pass behind.`,
}
/** Keep only instruction-derived successful burns, with the scanned signature.
 * Assets cannot be reminted after Core burns them, so this evidence stays valid
 * when DAS catches up on a later pass. Logs alone are never redemption evidence. */
export function rememberRedemptions(previous = [], findings = []) {
  const byAsset = new Map()
  for (const f of [...previous, ...findings.filter(f => f.kind === 'burn_via_program')])
    if (typeof f?.asset === 'string' && f.asset && typeof f.signature === 'string' && f.signature)
      byAsset.set(f.asset, { asset: f.asset, signature: f.signature })
  return [...byAsset.values()]
}
export function correlateBurns(findings, previous = []) {
  const viaProgram = new Set(rememberRedemptions(previous).map(f => f.asset))
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
    if (f.asset && viaProgram.has(f.asset) && f.kind === 'balance_unreadable' && f.state === 'absent') {
      out.push({ ...f, severity: S.INFO,
        detail: `vault ${f.asset}'s reserve account is absent after its confirmed redemption; DAS still listed the vault as live.` })
      continue
    }
    if (f.asset && viaProgram.has(f.asset) && REDEMPTION_NOISE[f.kind]) {
      out.push({ ...f, severity: S.INFO, detail: REDEMPTION_NOISE[f.kind](f.asset) })
      continue
    }
    if (f.kind === 'vault_burned' && f.asset) {
      out.push({ ...f,
        detail: `${f.detail} NO burn_vault was seen for it in any retained successfully scanned transaction, which is what a BARE Core BurnV1 looks like — nothing checked the contents.` })
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
 * none of our programs. BURN's header and SEAL's both say the gap is covered
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
        detail: `vault ${id} is owned by its OWN asset-signer PDA, so no key can sign for it. Anyone can run MINT's rescue_nested (host = the vault itself) to move it to the CBOBTC Squads, which returns it to the sender by hand; until then its payouts accrue inside it.` })
      continue
    }
    out.push({ kind: 'nested_vault', severity: S.CRITICAL, asset: id,
      detail: `vault ${id} is owned by vault ${host}'s asset-signer PDA (${owner}). It cannot be redeemed while it is there, and its sender may have pasted the wrong deposit address. Anyone can run MINT's rescue_nested (host = ${host}) to move it to the CBOBTC Squads, which returns it to whoever sent it in; that works whether or not ${host} has been burned.` })
  }
  // ---- the general case: ANY owner that cannot sign a top-level instruction ----
  for (const { id, owner } of vaults) {
    if (!owner) continue
    if (owners.has(owner)) continue            // already named above, more precisely
    // ROUND 35 (item 58): a rescued vault waits in the CBOBTC Squads until a person
    // returns it to its sender. Not unredeemable by accident: owed a return, so it
    // re-asserts every pass until it leaves.
    if (owner === CBOBTC_SQUADS) {
      out.push({ kind: 'vault_awaiting_return', severity: S.HIGH, asset: id,
        detail: `vault ${id} is held by the CBOBTC Squads after a rescue. Return it to the wallet that sent it into the vault it was found in (its transaction history shows the transfer), with an ordinary transfer from the Squads. Do not vote with it.` })
      continue
    }
    let ok
    try { ok = isOnCurve(owner) } catch { ok = null }
    if (ok === null || ok) continue            // unreadable is NOT a verdict
    out.push({ kind: 'unredeemable_owner', severity: S.CRITICAL, asset: id,
      detail: `vault ${id} is owned by ${owner}, which is OFF-CURVE — a program address, not a keypair. Redemption needs open_for_redemption and burn_vault as TWO TOP-LEVEL instructions signed by the owner, and a program signs only by CPI, which makes both halves inner and the pairing refuse. Either this vault is listed on a marketplace that escrows it (recoverable: delist and it returns), or it sits in a foreign Core asset's wallet (that asset's owner can move it out by executing through it; if that asset is burned, anyone can rescue_nested it to the CBOBTC Squads), or it is held by another program, which alone decides whether it can come back. MINT's owner-must-sign rule does NOT prevent this — is_signer is true for a PDA passed as a CPI signer.` })
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
    // Round 24 (L10c, L10d): every sweep the scan sees is remembered with its
    // block time, so the split check's horizon and the cycles' start times follow
    // the CHAIN rather than the ledger's own rows and stamps.
    if (opts.seenSweeps && signature) opts.seenSweeps.push({ sig: signature, blockTime: opts.blockTime ?? null })
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
    // ROUND 24 (L10a): a REAL sweep matched to a row that calls itself REFUSED.
    // That row is closed by `cycleIsOpen` and moved nothing as far as every other
    // reader knows, so a sweep filed under it was quiet in all three detectors.
    if (row.sendRejected) {
      out.push({ kind: 'sweep_on_rejected_row', severity: S.CRITICAL,
        detail: `transaction ${signature} swept ${onchain} lamports, and the ledger files it under a cycle marked as REFUSED (no SOL moved). A refused sweep moved nothing; this row hides a real one.` })
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
    if (row && row.sendRejected) {
      out.push({ kind: 'sweep_on_rejected_row', severity: S.CRITICAL,
        detail: `transaction ${d.sig} swept ${d.amount} lamports, and the ledger files it under a cycle marked as REFUSED (no SOL moved).` })
      continue
    }
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
/** Round 23 (L16): the split's TOTAL, in base units, or null when the entry
 *  predates it. An unknown total can anchor nothing. */
export function splitTotal(e) {
  const v = typeof e === 'string' ? null : e?.total
  if (v === undefined || v === null) return null
  try { return BigInt(v) } catch { return null }
}
export function dedupeSeenSplits(list) {
  const by = new Map()
  for (const e of (list || [])) {
    const k = splitSig(e); if (!k) continue
    // Prefer the richer record if the same signature arrives in both shapes.
    const cur = by.get(k)
    if (!by.has(k) || (splitTime(cur) == null && splitTime(e) != null)
        || (splitTotal(cur) == null && splitTotal(e) != null && splitTime(e) != null)) by.set(k, e)
  }
  return [...by.values()]
}

/**
 * HOW MUCH LEFT THE REVENUE ADDRESS'S cbBTC ACCOUNT IN THIS TRANSACTION (round
 * 23, L16). Only MINT can sign for that account and only `split_revenue` moves
 * out of it, so the sum of the token transfers whose SOURCE is that account is
 * the split's total. Read off the parsed instructions (top level and inner), not
 * off the balance delta, because a paid mint in the same transaction ADDS to the
 * account and a delta would under-read the split.
 *
 * BLIND TO: a transfer the RPC did not parse (no `parsed.info`). That reads as
 * less than was split, which can only fail an anchor (a false CRITICAL), never
 * pass one.
 */
export function revenueOutflow(ixs, revenueAta) {
  let total = 0n
  for (const ix of ixs || []) {
    if (ix.program !== TOKEN_ID && ix.program !== TOKEN22_ID) continue
    const t = ix.parsed?.type
    if (t !== 'transfer' && t !== 'transferChecked') continue
    const info = ix.parsed?.info || {}
    if (info.source !== revenueAta) continue
    const amt = info.amount ?? info.tokenAmount?.amount
    try { total += BigInt(amt) } catch { /* unparsed amount: under-reads, see above */ }
  }
  return total
}

/** ROUND 34 (L1): the alarm's split history above `limit` entries is a level
 *  HIGH finding with stable text (a stranger can add a split for one fee and one
 *  sat; each entry costs state and a sort). */
export function detectSplitHistoryGrowth(seenSplits, limit = 50_000) {
  return (seenSplits?.length ?? 0) > limit ? [{ kind: 'split_history_large', severity: S.HIGH,
    detail: `the alarm's record of cbBTC splits seen on chain holds more than ${limit} entries. Anyone can add one for a transaction fee and a single sat (paid to holders), so this may be someone growing the alarm's state to slow it. Splits older than every open revenue cycle's return can be pruned from state.json by hand.` }] : []
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
  // ⚠️ ROUND 24 (L10c): THE POSITION WAS STILL THE WRITER'S TO MOVE. Two hundred
  // EMPTY rows appended after a fabricated `splitSig` pushed it past the window,
  // and the check never asked. A row that neither moved anything nor claims a
  // split is padding and no longer counts toward the window (a row that claims
  // one is verified like any other), and every cycle whose sweep the SCAN saw on
  // chain is verified whatever its position: the horizon follows the chain.
  const sweptOnChain = new Set((opts.sweeps || []).map(e => e?.sig).filter(Boolean))
  const counts = c => !!(c?.splitSig || c?.splitByOther)
    || (!c?.sendRejected && BigInt(c?.sweptLamports ?? c?.intendedLamports ?? 0) > 0n)
  const recent = new Set([...cycles.filter(counts).slice(-verifyLastN),
    ...cycles.filter(c => c?.sweepSig && sweptOnChain.has(c.sweepSig))])
  const byS = new Map(entries.map(e => [splitSig(e), e]))
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
    if (nowMs - cycleStartMs(c, opts.sweeps, nowMs, opts.chainNow ?? null) < graceMs) continue
    if (!seen.has(c.splitSig)) {
      out.push({ kind: 'split_not_on_chain', severity: S.CRITICAL,
        detail: `cycle ${c.startedAt} records split ${c.splitSig}, which the transaction scan has not seen on the MINT program. A cycle that claims a split it cannot show is a cycle whose cbBTC may still be sitting unsplit.` })
      continue
    }
    // ⚠️ ROUND 24 (L10b): THE SIBLING BRANCH WAS NOT HELD TO L16. A `splitByOther`
    // cycle must be anchored by a split at or after its return and at least as
    // large; an explicit `splitSig` only had to EXIST, so a 1-sat split from
    // before the return closed a 5,000-sat cycle while the same data written as
    // `splitByOther` was CRITICAL. The named split must be at or after the return,
    // and the first split from the return up to it must cover what came back
    // (a split takes the whole balance, so the first one after the return does).
    if (BigInt(c.returnedSats ?? 0) > 0n) {
      const named = byS.get(c.splitSig)
      const at = splitTime(named)
      const anchor = at === null ? null : closesCycle(c, entries, { upTo: at })
      if (anchor === null) {
        out.push({ kind: 'split_claim_unanchored', severity: S.CRITICAL,
          detail: `cycle ${c.startedAt} names split ${c.splitSig}, but no cbBTC split at or after the cycle's own return${at === null ? '' : ' and no later than that one'} is as large as the ${c.returnedSats} sats it returned. A split from before the return, or a smaller one, cannot have divided this cycle's cbBTC.` })
      }
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
  const inWindow = byOther.filter(c => recent.has(c) && nowMs - cycleStartMs(c, opts.sweeps, nowMs, opts.chainNow ?? null) >= graceMs)
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
    //
    // ⚠️ ROUND 23 (L16): AND THE ANCHOR MUST BE BIG ENOUGH. Since round 22 the
    // crank splits EVERY HOUR, so "an unclaimed split after the return" became
    // nearly vacuous: any later crank split of a few sats of mint revenue vouched
    // for a cycle that claimed 5,000 returned sats were split by someone else. A
    // split takes the WHOLE balance, so the first split after a return carries
    // at least what came back: the anchor must total >= the cycle's
    // `returnedSats`. An entry with no recorded total (older state) anchors
    // nothing, which is the safe direction.
    const pool = entries.filter(e => !claimed.has(splitSig(e)) && splitTime(e) != null && splitTotal(e) != null)
      .sort((a, b) => splitTime(a) - splitTime(b))
    const used = new Set()
    const orphans = []
    for (const c of inWindow) {
      // Round 26: anonymous and explicit claims share the same chain-time
      // anchor, amount and legacy-row rules; consume each matching split once.
      const hit = closesCycle(c, pool, { exclude: used })
      if (hit) used.add(splitSig(hit)); else orphans.push(c)
    }
    if (orphans.length) {
      out.push({ kind: 'split_by_other_unanchored', severity: S.CRITICAL,
        detail: `${orphans.length} cycle(s) are closed as "someone else split it" with no cbBTC split on chain `
          + `after the cycle's own return, and at least as large as it, to account for them. A cycle closed on the ledger's own word with no `
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
      // ROUND 24 (L8): THE KEY IS NOT THE ASSET FOR TWO OF THE THREE RESERVES.
      // Balances are keyed `<vault>` for cbBTC and `<vault>:<mint>` for $GARY and
      // $GIRAFFISH (round 22, A8), and the whole key went out as `asset`, so
      // `correlateBurns` (which matches on the vault id) could never pair a $GARY
      // or $GIRAFFISH drop with that vault's own redemption: an honest
      // three-reserve redemption under DAS lag stayed HIGH on two of its three.
      const [vault, mint = null] = String(asset).split(':')
      out.push({ kind: 'reserve_fell', severity: S.HIGH, asset: vault, ...(mint ? { mint } : {}),
        detail: `vault ${vault}${mint ? ` (${mint})` : ''} reserve fell ${b - a} base units (${b} -> ${a}). Expected if it was redeemed; otherwise it is the drain the seal exists to prevent.` })
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
export function detectIndexShortfall(mintedTotal, liveIds, burntIds, opts = {}) {
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
  // ROUND 24 (L9): `minted_total` IS READ BEFORE THE DAS WALK, so a sale landing
  // in between reads N+1 in the index against N on chain: a CRITICAL on a
  // routine sale. The caller re-reads it AFTER the walk (`mintedAfter`); only a
  // MINT can add to the collection and `minted_total` never falls, so an index
  // count anywhere between the two reads is the race, not a fault. Anything
  // outside both still pages, at the same severity.
  const after = opts.mintedAfter === undefined || opts.mintedAfter === null ? null : BigInt(opts.mintedAfter)
  if (after !== null && after >= total && seen >= total && seen <= after) return out
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
  // ROUND 37 (C03): only LIVE lines define the variable. A commented-out
  // `# FLOCK="$FLOCK -n"` used to satisfy this, so a disabled lock passed.
  const live = src.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
  const varHasN = /^\s*FLOCK="?\$FLOCK\s+-n"?/m.test(live) || /^\s*FLOCK="?\/usr\/bin\/flock\s+-n"?/m.test(live)
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
  // Round 24 (I3): REDEEMED_POOL_FROZEN is MINT's (retire, reached by CPI from
  // BURN's redemption), so MINT is on top of the stack when it prints.
  const owner = { REDEEMED: ids.burn, DISTRIBUTED: ids.mint, REVEAL_RESCHEDULED: ids.mint, CLAIM_DEFERRED_FROZEN: ids.mint,
    REDEEMED_POOL_FROZEN: ids.mint, VAULT_RESCUED: ids.mint }
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
    else if (type === 'REDEEMED_POOL_FROZEN') events.push({ type, asset: kv.asset ?? null, forfeited: kv.forfeited_sats ?? null })
    else if (type === 'VAULT_RESCUED') events.push({ type, asset: kv.asset ?? null, host: kv.host ?? null, to: kv.to ?? null, orphan: kv.orphan === 'true' })
  }
  return { events, problem }
}

/**
 * Turn the programs' events into findings. RESCHEDULED, DEFERRED_FROZEN and
 * (round 24, I3) POOL_FROZEN forfeits each happen ONCE per occurrence: the scan
 * cursor moves past the transaction and nothing re-asserts them. So they are
 * `urgent`, and `planAlarmNotices` sends them with ALERT_URGENT=1.
 *
 * ⚠️ ROUND 24 (H1): this comment used to say ALERT_URGENT bypassed "the alert
 * router's recovery buffer". It did not, for a stream that was already OPEN:
 * the router keyed every alarm finding to ONE label, suppressed every later
 * emit on it for 12 h, and a one-shot fired in that window was logged and never
 * emailed while the alarm advanced its baseline. What is true now, and measured
 * in bank/selftest.mjs against the router itself: every finding KIND has its own
 * stream (`alarmLabel`), and since 2026-10-05 an URGENT emit carrying NEW text
 * breaks through an open stream (an identical urgent repeat inside 12 h stays
 * quiet). One-shot texts carry the pass time, so each is new.
 */
export function detectProgramEvents(events, sig = null) {
  const out = []
  for (const e of events || []) {
    if (e.type === 'REVEAL_RESCHEDULED') out.push({ kind: 'reveal_rescheduled', severity: S.HIGH, urgent: true, asset: e.asset,
      detail: `vault ${e.asset} (mint #${e.mintIndex}) missed its level-draw window and was RESCHEDULED (slot ${e.oldSlot} -> ${e.newSlot}, ${e.times} time(s)). The crank and every protocol transaction capture entropy; a lapse means all of them were absent for the whole window. It also hands that minter one re-roll (accepted limit 25). Tx ${sig || '?'}` })
    else if (e.type === 'CLAIM_DEFERRED_FROZEN') out.push({ kind: 'claim_deferred_frozen', severity: S.HIGH, urgent: true, asset: e.asset,
      detail: `vault ${e.asset}'s cbBTC account is FROZEN (cbBTC's freeze authority is Coinbase), so its payout of ${e.owed} sats was deferred. It stays owed in full; nothing was lost or redistributed. Tx ${sig || '?'}` })
    // Round 24 (I3): a holder's FORFEIT. A redemption while the POOL is frozen
    // lands and returns that vault's undelivered share to the pool (limit 28,
    // stage 3c). It was printed on chain and read by nothing, so the one record
    // of a holder losing sats was a log line nobody parsed.
    else if (e.type === 'REDEEMED_POOL_FROZEN') out.push({ kind: 'pool_frozen_forfeit', severity: S.HIGH, urgent: true, asset: e.asset,
      detail: `vault ${e.asset} was redeemed while the community pool's cbBTC account was FROZEN, so its undelivered share of ${e.forfeited} sats was FORFEITED back to the pool (accepted limit 28). The holder lost those sats; tell them. Tx ${sig || '?'}` })
    // ROUND 35 (item 58): a stuck vault was moved to the CBOBTC Squads, and a
    // person has to return it to its sender. Printed once, never re-asserted, so
    // urgent (vault_awaiting_return then re-asserts until it leaves the Squads).
    else if (e.type === 'VAULT_RESCUED') out.push({ kind: 'vault_rescued_to_squads', severity: S.HIGH, urgent: true, asset: e.asset,
      detail: `vault ${e.asset} was rescued to the CBOBTC Squads (${e.to}) because ${e.host === e.asset ? 'it sat in its own deposit address' : e.orphan ? `the vault it was in (${e.host}) was burned` : `it was inside another holder's vault ${e.host}`}. It keeps its level, seal and everything it earned. Find the wallet that sent it there in ${e.asset}'s transaction history and return it from the Squads. Tx ${sig || '?'}` })
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
export function detectDistributionOverdue(cur, { nowSec, poolAvail, graceSecs = 6 * 3600, poolFrozen = false } = {}) {
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
    // A DUE $CBOB boost holds every distribution the same way (BoostsExpireFirst).
    const bd = big(cur['mint.boosts_due'])
    if (bd !== null && bd > 0n && BigInt(nowSec) - last > BigInt(graceSecs)) stalls.push({ kind: 'boosts_stalled', severity: S.HIGH,
      detail: `${bd} $CBOB boost(s) had their last distribution at unix ${last} and are still not expired. Until they are, NO distribution can run. The crank expires them each pass; anyone can, free (\`expire_boosts\` naming them).` })
    // Nobody joined yet and some asked: the free monthly run is what lets them in.
    if (w === 0n && pt > 0n && BigInt(nowSec) > last + period + BigInt(graceSecs)) stalls.push({ kind: 'launch_tick_overdue', severity: S.CRITICAL,
      detail: `${pt} vault(s) have asked to activate and NOBODY is on the payout schedule, but the free monthly run that lets them join has not happened (due unix ${last + period}). Anyone can run it free: \`distribute(false)\`.` })
  }
  if (w === 0n) return stalls
  if (poolAvail === null || poolAvail === undefined || BigInt(poolAvail) <= 0n) return stalls
  const due = last + period
  const late = BigInt(nowSec) - due
  if (late <= BigInt(graceSecs)) return stalls
  // ROUND 45 (V45o-3): a FROZEN pool is not a failure to run. The crank and MINT's
  // in-line run both decline to credit from it by design (SPEC limit 28), and
  // pool_frozen pages beside this. The text says so instead of blaming every layer.
  if (poolFrozen) return [...stalls, { kind: 'distribution_overdue', severity: S.CRITICAL,
    detail: `no distribution for ${(BigInt(nowSec) - last) / 3600n}h (due at unix ${due}, ${late / 3600n}h late, ${poolAvail} sats undistributed), because the community pool's cbBTC account is FROZEN (see pool_frozen). The crank and the in-line monthly run decline to credit from a frozen pool by design; the distribution waits for the thaw. There is nothing to run by hand.` }]
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

/**
 * THE REVENUE ADDRESS'S cbBTC ACCOUNT, AND HOW LONG ITS BALANCE HAS WAITED
 * (round 23: M1, L9, L10). Returns `{ since, findings }`; the caller feeds
 * `since` to `detectUnsplitRevenue` and stores it for the next pass.
 *
 * M1, THE CLOCK. It used to reset only when a pass saw a ZERO balance. The crank
 * splits at :37 and the alarm samples at :23 and :53, so during any sale with a
 * mint every ~16 minutes no pass ever saw zero, and six hours in it paged
 * `revenue_unsplit` every half hour although the crank had split every hour. A
 * split takes the WHOLE balance, so whatever is there now arrived after the last
 * split: the clock is the LATER of the first sighting and the last cbBTC split
 * the scan has seen (`splits`, the alarm's `seenSplits`).
 *
 * L10: an unreadable account (absent, foreign, malformed, or no answer) after
 * initialize is HIGH, and the previous `since` is KEPT: a failed read used to
 * reset the clock, so a flapping RPC hid a real stall for ever.
 *
 * L9: a FROZEN account is HIGH at ANY balance. Frozen with nothing in it, every
 * paid mint (which pays into it) and every swap return fails while the old
 * check, which only looked at a positive balance, stayed quiet.
 *
 * BLIND TO: a split the signature walk has not reached yet (it reads as a
 * longer wait, the loud direction), and whether the split it saw moved THIS
 * balance (any split empties the account, so it did).
 */
export function detectRevenueAccount({ read, prevSince = null, splits = [], nowSec } = {}) {
  const findings = []
  if (!read || read.state !== 'ok') {
    findings.push({ kind: 'revenue_account_unreadable', severity: S.HIGH,
      detail: `the revenue address's cbBTC account reads as ${read ? read.state : 'no answer'}. Every paid mint pays into it and every split reads it; road step 10 creates it right after initialize. The unsplit clock was kept, not reset.` })
    return { since: prevSince ?? null, findings }
  }
  if (read.frozen) findings.push({ kind: 'revenue_account_frozen', severity: S.HIGH,
    detail: `the revenue address's cbBTC account is FROZEN (cbBTC's freeze authority is Coinbase), holding ${read.amount} sats. Every paid mint and every swap return into it fails, and nothing in it can be split, until it is thawed. Nothing on Solana can prevent or undo this (accepted limit 28).` })
  if (!(BigInt(read.amount ?? 0) > 0n)) return { since: null, findings }
  let since = prevSince ?? nowSec
  for (const e of splits || []) {
    const t = splitTime(e)
    if (t !== null && t !== undefined && t > since) since = t
  }
  return { since, findings }
}

/** ROUND 25 (L4): how often scripts/cron-install.sh runs bank/revenue.mjs. Was
 *  6 h, equal to the ruled 6 h cooldown, so every run landed a second or two
 *  before `last_sweep_at + cooldown` and skipped (a 12 h cadence). Hourly; the
 *  cooldown gate makes the extra runs no-ops. The installer's line is asserted
 *  to run at exactly this period, shorter than the ruled cooldown. */
export const REVENUE_CRON_PERIOD_SECS = 3600

/**
 * ROYALTY SOL NOBODY SWEPT (round 23, M4). Limit 7 said every job's stall was
 * "survivable rather than silent", naming revenue, and for revenue it was
 * silent: nothing read the revenue address's lamports, no ledger row exists for
 * a sweep that never ran, and `distribution_overdue` needs cbBTC in the pool.
 * A dormant, wedged or dead `revenue.mjs` left royalties sitting for ever.
 *
 * HIGH while the sweepable excess (lamports above the voted reserve) is at
 * least the sweep floor fixed at initialize (1 SOL) and has been for the grace:
 * a day, OR the voted cooldown plus one revenue cron period plus an hour,
 * whichever is longer. ROUND 25 (L4): the grace assumed "four of revenue's
 * 6-hourly cycles", but a vote may lengthen the cooldown to the 24 h ceiling,
 * and then a WORKING sweep (one per cooldown, picked up at the next hourly run,
 * seen at the next alarm pass) falls every ~25 h and paged HIGH between falls.
 * Pass `cooldownSecs` (the on-chain value). The clock restarts whenever the
 * balance FALLS between passes, because a fall is a sweep (nothing else moves
 * SOL out of that PDA). A capped sweep resets the clock only when its decrease
 * remains visible after incoming royalties between the two readings.
 * Quiet while the guardian's sweep brake is on: that accrual is deliberate and
 * `sweep_stopped` already says so. Returns `{ since, findings }`.
 *
 * BLIND TO: a sweep that moved less than arrived in the same half hour (the
 * balance did not fall, so the clock runs on; the loud direction).
 */
export function detectUnsweptRoyalties({ lamports, reserve, floor, prevLamports = null, prevSince = null, nowSec,
  sweepStopped = false, graceSecs = 24 * 3600, cooldownSecs = null } = {}) {
  if (cooldownSecs !== null && cooldownSecs !== undefined && Number.isFinite(Number(cooldownSecs)))
    graceSecs = Math.max(Number(graceSecs), Number(cooldownSecs) + REVENUE_CRON_PERIOD_SECS + 3600)
  if (lamports === null || lamports === undefined || reserve === undefined || reserve === null
      || floor === undefined || floor === null) return { since: null, findings: [] }
  const excess = BigInt(lamports) - BigInt(reserve)
  if (excess < BigInt(floor)) return { since: null, findings: [] }
  let since = prevSince ?? nowSec
  if (prevLamports !== null && prevLamports !== undefined && BigInt(lamports) < BigInt(prevLamports)) since = nowSec
  if (sweepStopped || BigInt(nowSec) - BigInt(since) <= BigInt(graceSecs)) return { since, findings: [] }
  return { since, findings: [{ kind: 'royalties_unswept', severity: S.HIGH,
    detail: `${excess} lamports of royalty SOL are currently above the ${reserve} reserve, with no observed net balance decrease since unix ${since}. The revenue job may be inactive or failing, or incoming royalties may have masked successful sweeps between readings. Check bank/revenue.mjs, the on-chain transactions and the ledger before concluding that it stopped.` }] }
}

/** Round 23 (M3): the crank's heartbeat file, `{"atSec": <unix>}`, written by
 *  every LIVE full pass. Anything unreadable is NO heartbeat (`null`), which
 *  pages when the crank is armed, never a fresh one. */
export function parseCrankHeartbeat(raw) {
  if (raw === null || raw === undefined) return null
  try { const v = Number(JSON.parse(raw)?.atSec); return Number.isFinite(v) && v > 0 ? v : null } catch { return null }
}

/** Round 23 (M3): is the crank's FULL-PASS line armed? The same question
 *  `scripts/cron-install.sh` answers for its posture print: our tagged crank
 *  line, not commented out, not the reveal lane, carrying `--live`. */
export function crankArmed(crontab) {
  return String(crontab || '').split('\n').some(l => !/^\s*#/.test(l) && /#cbob-vault-cron crank\s*$/.test(l)
    && !/--reveal-only/.test(l) && /\bbank\/crank\.mjs --live\b/.test(l))
}

/**
 * THE CRANK STOPPED, AND NOTHING ELSE COULD SAY SO (round 23, M3; round 22 A4's
 * repair was incomplete). If the crank's full pass dies while traffic keeps
 * running the monthly distribution in-line, `owed_scaled` grows, nobody is
 * delivered a sat, and every other detector stays quiet: nothing is overdue, the
 * pool is solvent, no reveal is stuck. The crank stamps a heartbeat after each
 * LIVE full pass; this pages HIGH when the crank is ARMED and the newest of
 * (heartbeat, the moment the alarm first saw it armed) is more than `maxAgeSecs`
 * (3 h: three missed hourly passes) old. A dry-run crank is not expected to
 * deliver anything, so it is quiet.
 *
 * BLIND TO: an arming done outside our tagged crontab line. Round 24 (L4): a
 * live pass that ran and sent nothing useful is no longer only the crank's own
 * word: the heartbeat carries its failures and problems, and `detectCrankHealth`
 * pages when they repeat. And the crank's own pages no longer go quiet after the
 * first one (H1): each lane has its own stream and sends a RECOVERY when a live
 * pass is clean again, so the next failure opens a fresh stream.
 */
export function detectCrankSilent({ stampSec = null, live, armedSinceSec = null, nowSec, maxAgeSecs = 3 * 3600 } = {}) {
  if (!live) return []
  const last = [stampSec, armedSinceSec].filter(v => v !== null && v !== undefined).reduce((a, b) => (b > a ? b : a), null)
  const ref = last ?? nowSec
  if (BigInt(nowSec) - BigInt(ref) <= BigInt(maxAgeSecs)) return []
  return [{ kind: 'crank_silent', severity: S.HIGH,
    detail: `the crank is armed (--live) and its last completed full pass was ${stampSec ? `at unix ${stampSec}` : 'never recorded'}, over ${maxAgeSecs / 3600} h ago. Nothing is joining, expiring or delivering claims; credited shares sit in the pool undelivered. Anyone can crank (every instruction is permissionless).` }]
}

/** Round 23 (L12): the lock date is the EARLIER of the box file's
 *  `lock_deadline` and MINT's on-chain `charter_opens_at`, which is immutable and
 *  is the bound Gary ruled (nothing holds value under an upgradeable program). A
 *  missing file no longer means no deadline once MINT is initialized. */
export function lockDeadlineOf(fileSec, charterOpensAt) {
  const xs = [fileSec, charterOpensAt].map(Number).filter(v => Number.isFinite(v) && v > 0)
  return xs.length ? Math.min(...xs) : null
}

/** A VAULT RESERVE ACCOUNT FROZEN (round 22, F6). Only cbBTC has a live freeze
 *  authority (Coinbase). A frozen account blocks that vault's claims (cbBTC) and
 *  its WHOLE redemption, because BURN requires every reserve account empty and a
 *  frozen account cannot be emptied. Nothing on Solana can undo it. */
export function detectFrozenVaultAccount({ vault, mint, isPayment }) {
  return [{ kind: 'vault_account_frozen', severity: S.HIGH, asset: vault, mint,
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
 * lock date (`lockDeadlineOf`: the earlier of launch/mainnet-init.json's
 * `lock_deadline` and MINT's `charter_opens_at`, round 23 L12) an upgrade
 * authority is expected (the deploy needs it); after it, any of our five programs still upgradeable is a
 * standing CRITICAL every pass, because whoever holds that key can rewrite every
 * rule this system promises — and its holders were told nobody can.
 */
export function detectUpgradeAuthorityAfterLock(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (!production) return []
  // ROUND 22 (A5): NOTHING SET THE DEADLINE, so this never ran. In production, a
  // deployed program of ours that is still upgradeable with NO deadline on record
  // is itself the finding.
  if (production && !(Number(lockDeadlineSec) > 0)) {
    const live = ['seal', 'mint', 'burn', 'gov', 'sweep'].filter(p => {
      const v = cur[`prog.${p}.upgrade_authority`]; return v !== undefined && v !== null && v !== 'IMMUTABLE' })
    return live.length ? [{ kind: 'lock_deadline_unset', severity: S.CRITICAL,
      detail: `${live.join(', ').toUpperCase()} ${live.length > 1 ? 'are' : 'is'} deployed and still upgradeable, and no lock deadline is set (launch/mainnet-init.json lock_deadline). Holders were told nobody can change the rules.` }] : []
  }
  if (!lockDeadlineSec || nowSec === undefined || BigInt(nowSec) < BigInt(lockDeadlineSec)) return []
  const out = []
  for (const p of ['seal', 'mint', 'burn', 'gov', 'sweep']) {
    const v = cur[`prog.${p}.upgrade_authority`]
    if (v === undefined) continue
    if (v === null || v === 'IMMUTABLE') continue
    out.push({ kind: 'program_not_locked', severity: S.CRITICAL,
      detail: `the ${p.toUpperCase()} program is STILL UPGRADEABLE by ${v}, past the launch-lock date (unix ${lockDeadlineSec}). Holders were told nobody can change the rules. Remove the upgrade authority (\`solana program set-upgrade-authority --final\`).` })
  }
  return out
}

// ═════════════════════════ round 24 (2026-10-05) ═════════════════════════

/**
 * IS THE CRANK ARMED? THREE ANSWERS, NOT TWO (round 24, L4a).
 *
 * `crontab -l` failing read as "not armed", which reset `crankArmedSince` and
 * silenced `crank_silent`: fail-open, against this pipeline's own first rule (a
 * read that fails is an ALARM). `read` is `{ text }` or `{ error: { status,
 * stderr } }`. cron's "no crontab for <user>" is a real answer (nothing is
 * armed); anything else that fails is 'unreadable'.
 */
export function crankPosture(read) {
  if (!read) return 'unreadable'
  if (read.error) return /no crontab for/i.test(String(read.error.stderr ?? '')) ? 'dry' : 'unreadable'
  return crankArmed(read.text) ? 'armed' : 'dry'
}
/** Round 24 (L4a): the posture, judged. An unreadable crontab is HIGH and KEEPS
 *  the armed-since clock; while it was armed before, the silence check still runs
 *  (`live`), because a crank we cannot see is not one we may assume stopped. */
export function detectCrankPosture({ posture, prevArmedSince = null, nowSec }) {
  if (posture === 'armed') return { live: true, armedSince: prevArmedSince ?? nowSec, findings: [] }
  if (posture === 'dry') return { live: false, armedSince: null, findings: [] }
  return { live: prevArmedSince !== null && prevArmedSince !== undefined, armedSince: prevArmedSince ?? null,
    findings: [{ kind: 'crank_posture_unreadable', severity: S.HIGH,
      detail: `the crontab could not be read, so whether the crank is armed is UNKNOWN. ${prevArmedSince ? `It was armed at unix ${prevArmedSince}, so the silence check keeps running against that.` : 'It was not armed at the last reading.'} Check \`crontab -l\` as ubuntu.` }] }
}

/** Round 24 (L4b): the WHOLE heartbeat, `{ atSec, failures, problems }`.
 *  `parseCrankHeartbeat` kept only the stamp, so a pass whose every action failed
 *  read as a fresh, healthy one. Unreadable is null, as before. */
export function readCrankBeat(raw) {
  const atSec = parseCrankHeartbeat(raw)
  if (atSec === null) return null
  let j = {}
  try { j = JSON.parse(raw) } catch { j = {} }
  const failures = Number.isFinite(Number(j.failures)) ? Number(j.failures) : 0
  const problems = Array.isArray(j.problems) ? j.problems.map(String) : []
  return { atSec, failures, problems }
}
/** A problem's identity across passes: numbers move (owed sats grow), the
 *  vault and the reason do not. */
const problemKey = p => String(p).replace(/\b\d+\b/g, '#')
/**
 * THE CRANK RAN, AND KEPT FAILING THE SAME WAY (round 24, L4b/L4c).
 *
 * `plan.problems` (an owed vault left out of every claim batch, an eligible vault
 * that cannot be read) were printed to the crank's log and paged nothing, and the
 * heartbeat's failure count was thrown away. Each NEW heartbeat (a new `atSec`)
 * advances two streaks; `k` consecutive live passes with failed actions pages
 * `crank_failing`, and one problem present in `k` consecutive passes pages
 * `crank_problem`. Both are LEVEL findings: they re-assert every alarm pass while
 * the streak stands, and clear when a pass breaks it. Returns `{ findings, next }`.
 */
export function detectCrankHealth({ beat, prev = null, k = 3, coveredFreezes = {} } = {}) {
  // Only these complete planner messages describe a freeze already reported by
  // its transition detector. Mixed blockers and failed actions stay visible.
  const covered = p => (coveredFreezes.pool &&
    // Round 37 (C02): the crank's text changed with the frozen-pool tick; this
    // must equal crank.mjs's exactly (selftest R27 L2 drives the real planner).
    (p === 'the pool cbBTC account is FROZEN; nothing can be paid until it is thawed (the free tick and joins still go through)' ||
     /^the revenue address holds \d+ sats and cannot be split: the community pool's cbBTC account is FROZEN$/.test(p))) ||
    (coveredFreezes.revenue && p === "the revenue address's cbBTC account is FROZEN; nothing in it can be split until it is thawed")
  let next = prev ? { lastAt: prev.lastAt ?? null, failStreak: prev.failStreak ?? 0, problems: { ...(prev.problems || {}) } }
    : { lastAt: null, failStreak: 0, problems: {} }
  // Prune even on a duplicate heartbeat; persisting the deletion prevents a
  // stale pre-thaw heartbeat resurrecting the old streak after thaw.
  for (const [key, v] of Object.entries(next.problems)) if (covered(v.text)) delete next.problems[key]
  if (beat && beat.atSec !== next.lastAt) {
    const problems = {}
    for (const p of beat.problems || []) { if (covered(p)) continue; const key = problemKey(p); problems[key] = { n: (next.problems[key]?.n ?? 0) + 1, text: p } }
    next = { lastAt: beat.atSec, failStreak: beat.failures > 0 ? next.failStreak + 1 : 0, problems }
  }
  const findings = []
  if (next.failStreak >= k) findings.push({ kind: 'crank_failing', severity: S.HIGH,
    detail: `the crank's last ${next.failStreak} live full passes each had failed actions (the latest at unix ${next.lastAt}). It runs, and it is not getting its work done; its log names each failure.` })
  for (const v of Object.values(next.problems)) if (v.n >= k) findings.push({ kind: 'crank_problem', severity: S.HIGH,
    detail: `for ${v.n} live full passes in a row the crank has reported: ${v.text}` })
  return { findings, next }
}

/** An absent own config/program is expected during setup, not after launch's
 * lock deadline. Explicit missing flags include first observations, which have
 * no prior drift baseline. Rehearsals retain their setup tolerance. */
export function detectMissingComponents(cur, { lockDeadlineSec, nowSec, production = false } = {}) {
  if (!production || !Number.isFinite(Number(lockDeadlineSec)) || !(Number(lockDeadlineSec) > 0)
      || !Number.isFinite(Number(nowSec)) || Number(nowSec) < Number(lockDeadlineSec)) return []
  const keys = ['seal', 'mint', 'burn', 'gov', ...['seal', 'mint', 'burn', 'gov', 'sweep'].map(p => `prog.${p}`)]
  const missing = keys.filter(k => cur[`${k}._missing`] === true)
  return missing.length ? [{ kind: 'component_missing', severity: S.HIGH,
    detail: `past the launch-lock date (unix ${lockDeadlineSec}), these required configs or program accounts read as ABSENT: ${missing.join(', ')}. Check deployment, initialization and RPC reads; an absent first reading is not a completed launch.` }] : []
}

/**
 * THE DRIFT BASELINE CARRIES THE LAST VALUE A KEY ACTUALLY HELD (round 24, L5).
 *
 * Round 23's L11 skipped a key whose program read as ABSENT in the previous
 * snapshot. A one-pass failed read of SEAL, BURN, GOV or a `prog.*` ProgramData
 * reads exactly that way, so a value changed across the blip went old -> null (a
 * page that reads like an RPC hiccup) and then null -> NEW (skipped): the change
 * itself was never compared. The stored baseline now keeps the last NON-NULL
 * value of every key, so the next pass compares new against old. A key that
 * never held a value is still skipped by L11, exactly as before.
 */
/**
 * THE UNREADABLE RETRY COUNT SURVIVES A PASS THAT DID NOT REACH IT (round 45,
 * V45o-4). The alarm kept only the counts of signatures it attempted this pass,
 * so a flood that pushed an unreadable signature past the pass's budget reset it
 * to "pass 1 of 3" and it held the walk for four passes, not the three SPEC
 * states. A signature attempted this pass takes this pass's count (or leaves the
 * map: read, or skipped); one not attempted keeps the count it had.
 */
export function carryUnreadPasses(prev, now, attempted) {
  const out = {}
  for (const [sig, n] of Object.entries(prev || {})) if (!attempted?.has(sig)) out[sig] = n
  return { ...out, ...(now || {}) }
}

export function carryConfigBaseline(prev, cur) {
  const out = { ...(cur || {}) }
  for (const [k, v] of Object.entries(prev || {})) {
    if (k.endsWith('._missing')) continue
    if ((out[k] === undefined || out[k] === null) && v !== undefined && v !== null) out[k] = v
  }
  return out
}

/**
 * ONE RESERVE ACCOUNT, READ (round 24, L7). A batched read can succeed as a call
 * and still carry a null, foreign or malformed element, and the alarm stored
 * every one of those as `0`: a false HIGH `reserve_fell`, and a zero baseline
 * under the next real drop, against its own claim that the last known value is
 * carried forward. `read` is bank/spl.mjs's answer. Returns `{ value, finding }`:
 *   ok                          -> its amount
 *   absent, never held a value  -> '0', quietly (a reserve never funded)
 *   anything else with a prior  -> the prior value carried, and HIGH
 *   anything else, no prior     -> nothing stored, and HIGH
 */
export function judgeReserveRead(prevValue, read) {
  const prior = prevValue === undefined || prevValue === null ? null : String(prevValue)
  if (read?.state === 'ok') return { value: String(read.amount), finding: null }
  if (read?.state === 'absent' && (prior === null || BigInt(prior) === 0n)) return { value: '0', finding: null }
  return { value: prior, finding: { state: read?.state ?? 'no answer', carried: prior } }
}

/**
 * A FREEZE IS NEWS ONCE (round 24, I5). `pool_frozen` (urgent), the vault and
 * revenue-account freezes re-asserted every pass with no way to ack them, which
 * under H1 kept their stream open and muted everything behind it. A freeze is
 * paged when it HAPPENS; while it stands it stays visible at INFO; when it ends
 * it simply stops. `prevFrozen` is the set of keys frozen at the last delivered
 * pass. Returns `{ findings, frozen }`, `frozen` being this pass's set.
 */
export const FROZEN_KINDS = new Set(['pool_frozen', 'vault_account_frozen', 'revenue_account_frozen'])
export function applyFrozenTransitions(findings, prevFrozen = []) {
  const before = new Set(prevFrozen || [])
  const frozen = []
  const out = (findings || []).map(f => {
    if (!FROZEN_KINDS.has(f.kind)) return f
    const key = `${f.kind}:${f.asset ?? ''}:${f.mint ?? ''}`
    frozen.push(key)
    if (before.has(key)) return { ...f, severity: S.INFO, urgent: false,
      detail: `${f.detail} (STILL frozen: this was paged when it froze, and is listed here until it thaws.)` }
    return { ...f, urgent: true }
  })
  return { findings: out, frozen }
}

/**
 * DRESS REHEARSAL OR PRODUCTION (round 24, D5). The alarm judged every pass as
 * mainnet (`production: true`), so a rehearsal at throwaway values paged
 * `test_value_in_production` every pass, and at ruled values a rehearsal cannot
 * mint for ten days. `CBOB_ALARM_REHEARSAL=1`, EXACTLY, turns the production-only
 * value checks off and says so at the top of every report; anything else, set or
 * not, is production. Fails closed: a typo is production, never a quiet rehearsal.
 */
export function alarmProduction(env = {}) {
  return env.CBOB_ALARM_REHEARSAL !== '1'
}

// ─────────────────────── THE NOTIFY PLAN (round 24, H1) ───────────────────────
//
// WHAT WAS WRONG. `report()` sent ONE notify per pass, labelled
// `cbob-vault-alarm`, carrying only the first finding's text, and treated exit 0
// as delivered, after which `main()` advanced every baseline. The router keys a
// stream by label and, once a stream had emailed, SUPPRESSED every later emit on
// it (12 h, then one reminder a day), returning 0. So a one-shot CRITICAL fired
// while any earlier alarm stream was open (a config change, a fixed-forever value,
// the Core hash, a pulled brake, an unledgered sweep, a bare burn) was logged,
// never emailed, and never retried, because its baseline had moved. Measured
// against the router in a scratch state dir; the live router held
// `cbob-vault-alarm` OPEN for two days from one "FAILED TO RUN" note.
//
// WHAT IS TRUE NOW:
//   * one notify per finding KIND, labelled `cbob-vault-alarm:<kind>`, so one
//     kind's open stream mutes nothing else (labels are <= 40 characters, or the
//     router folds them into its shared 'alert' stream; asserted with the
//     router's own `stream_key`);
//   * every kind whose baseline the alarm advances after reporting (ONE-SHOT) is
//     sent ALERT_URGENT=1 with the pass time in its text, so it is always new
//     information and breaks through an open stream (the router's 2026-10-05
//     fix); a LEVEL kind re-asserts while true and is left to the router's buffer;
//   * the full detail list for the kind, not the first line;
//   * on the first FULL pass after a level kind paged and found nothing, a
//     RECOVERY for that kind's stream. Not for one-shot kinds: the router drops a
//     still-PENDING alert when a recovery arrives on its stream, so a one-shot
//     whose delivery was being retried would be cancelled unsent. A one-shot's
//     stream closes by the router's own expiry, and breaks through when it fires
//     again anyway.

export const ALARM_LABEL = 'cbob-vault-alarm'
/** Every kind any detector or the alarm emits, classified. 'once' = the baseline
 *  moves past it after reporting (urgent); 'level' = it re-asserts every pass
 *  while true; 'info' = never pages. An UNLISTED kind is treated as 'once' (the
 *  loud direction: a surplus email, never a swallowed incident), and selftest
 *  requires every `kind:` literal in the alarm's sources to be listed. */
export const ALARM_KINDS = {
  // one-shot: the transaction scan's cursor, the vault set, the balances, the
  // config baseline or the frozen set moves past them
  approve: 'once', non_ata_token_account: 'once', bare_core_burn: 'once', vault_burned: 'once', vault_left_index: 'once',
  config_drift: 'once', brake_pulled: 'once', brake_released: 'once', unledgered_sweep: 'once', sweep_amount_mismatch: 'once',
  sweep_on_rejected_row: 'once', reserve_fell: 'once', reveal_rescheduled: 'once', claim_deferred_frozen: 'once', vault_rescued_to_squads: 'once',
  pool_frozen_forfeit: 'once', pool_frozen: 'once', vault_account_frozen: 'once', revenue_account_frozen: 'once',
  watchdog_gap: 'once', log_unparseable: 'once', revenue_age_unknown: 'once', sweep_unledgered_state: 'once',
  // level: re-asserted by every pass while the condition holds
  vault_index_shrank: 'level', split_not_85_15: 'level', swap_operator_armed: 'level', guardian_armed: 'level',
  sweep_bound_ineffective: 'level', sweep_cooldown_too_short: 'level', test_value_in_production: 'level',
  collections_disagree: 'level', revenue_ledger_unreadable: 'level', unreconciled_swap: 'level', cycle_unsplit: 'level',
  short_swap_return: 'level', rejected_row_has_sweep: 'level', undeclared_token_account: 'level', vault_owns_itself: 'level',
  nested_vault: 'level', unredeemable_owner: 'level', vault_awaiting_return: 'level', split_sig_reused: 'level', split_not_on_chain: 'level',
  split_by_other_unanchored: 'level', split_claim_unanchored: 'level', index_self_contradictory: 'level',
  index_disagrees_with_chain: 'level', joins_stalled: 'level', boosts_stalled: 'level', launch_tick_overdue: 'level',
  distribution_overdue: 'level', pool_unreadable: 'level', pool_insolvent: 'level', redemptions_near_cap: 'level',
  revenue_unsplit: 'level', revenue_account_unreadable: 'level', royalties_unswept: 'level', crank_silent: 'level',
  crank_posture_unreadable: 'level', crank_failing: 'level', crank_problem: 'level', reveal_queue_stalled: 'level',
  lock_deadline_unset: 'level', program_not_locked: 'level', component_missing: 'level', config_vanished: 'level', balance_unreadable: 'level',
  scan_gap: 'level', scan_cursor_unresolvable: 'level', scan_backlog_unproven: 'level', log_coverage_gap: 'level', tx_skipped_unreadable: 'level', split_history_large: 'level', tx_unreadable: 'level', run_failed: 'level', reconcile_failed: 'level',
  // never paged
  reserve_ata_created: 'info', burn_via_program: 'info', sales_stopped: 'info', sweep_stopped: 'info', guardian_retired: 'info',
  log_truncated_foreign: 'info', joins_waiting: 'info', sweep_cooldown_wedged: 'info', sweep_cap_wedged: 'info', distributed: 'info', redeemed: 'info',
}
/** The router folds a label longer than 40 characters into its shared 'alert'
 *  stream, so the kinds that do not fit beside the prefix get a short name. */
const ALARM_SHORT = {
  index_disagrees_with_chain: 'index_vs_chain', split_by_other_unanchored: 'split_by_other_orphan',
  sweep_cooldown_too_short: 'sweep_cooldown_short', index_self_contradictory: 'index_contradicts',
  revenue_ledger_unreadable: 'ledger_unreadable', revenue_account_unreadable: 'revenue_ata_unreadable',
  scan_cursor_unresolvable: 'scan_cursor_lost', test_value_in_production: 'test_value_in_prod',
  undeclared_token_account: 'undeclared_token_acct', crank_posture_unreadable: 'crank_posture_unread',
}
export const alarmLabel = (kind, prefix = ALARM_LABEL) => `${prefix}:${ALARM_SHORT[kind] ?? kind}`
export const isOneShotKind = (kind, kinds = ALARM_KINDS) => kinds[kind] !== 'level'

/** The router's RECOVERY pattern, mirrored, and asserted equal to the router's
 *  own in selftest. A LEVEL alert whose detail happened to say "resolved"
 *  ("cannot be resolved by the cluster") was classified RECOVERY by the router,
 *  which CLOSED its stream instead of opening it. Urgent alerts are classified
 *  before this pattern is consulted, so only non-urgent text is defanged. */
export const ROUTER_RECOVERY_SRC = String.raw`\b(recovered|recovery|all[ -]?clear|back (?:to normal|online|up)|normally again|healthy again|self-certifying again|is fine again|no longer (?:stale|dark|failing|blocked)|resolved|cleared|quota healthy)\b|\bback to \$\d|\bback under \d+%`
// Round 26: one revenue failure must not mute a later failure in another step.
// The marker set belongs to LIVE execution; the planner itself has no effects.
export const REVENUE_STAGES = ['lock', 'config', 'key', 'recovery', 'funding', 'market', 'prepare', 'sweep', 'swap', 'return', 'split']
export function revenueNotices({ stage, error = null, previous = [], passed = [] }) {
  const notices = [...new Set(previous)].filter(s => REVENUE_STAGES.includes(s) && passed.includes(s) && !(error !== null && s === stage)).map(s => ({
    stage: s, label: `cbob-revenue:${s}`, recovery: true,
    text: `CBOB REVENUE (${s}) RECOVERED: a live pass completed this step without an error.` }))
  if (error !== null) {
    const key = REVENUE_STAGES.includes(stage) ? stage : 'config'
    notices.push({ stage: key, label: `cbob-revenue:${key}`, recovery: false,
      text: defangForRouter(`CBOB REVENUE CYCLE FAILED (${key}): ${String(error?.message ?? error)}`).slice(0, 60_000) })
  }
  return notices
}

/**
 * A REHEARSAL RUN NEVER SHARES A PRODUCTION STREAM (round 44, V44o-5). The alarm
 * says REHEARSAL in every notice; the crank and the revenue job did not, so a
 * rehearsal run used the production `cbob-vault-crank:*` and `cbob-revenue:*`
 * streams unless the operator remembered to move the router's state. Inside a
 * tree carrying REHEARSAL-RECORD.txt (where `/opt/cbob-vaults/...` is root-mapped
 * to the rehearsal tree) both jobs pass `rehearsal: true`: the label moves to its
 * own `<stream>-rehearsal` family and the text says REHEARSAL.
 */
export const REHEARSAL_MARKER = '/opt/cbob-vaults/REHEARSAL-RECORD.txt'
export function rehearsalNotice(n, rehearsal) {
  if (!rehearsal) return n
  return { ...n, label: String(n.label).replace(/^([^:]+)/, '$1-rehearsal'),
    text: String(n.text).replace(/^CBOB (crank|CRANK|REVENUE)/, m => `${m} (REHEARSAL)`) }
}

export function defangForRouter(text) {
  const re = new RegExp(ROUTER_RECOVERY_SRC, 'gi')
  let t = String(text)
  for (let i = 0; i < 5 && new RegExp(ROUTER_RECOVERY_SRC, 'i').test(t); i++)
    t = t.replace(re, m => (m.length > 2 ? `${m.slice(0, -2)}-${m.slice(-2)}` : m))
  return t
}
/** A single argv string the kernel accepts (MAX_ARG_STRLEN is 128 KiB); a kind
 *  with thousands of findings must not fail delivery and hold every baseline. */
const NOTICE_MAX_CHARS = 60_000

/**
 * PURE: WHAT THIS PASS TELLS THE ROUTER. `findings` is the finished list (acks
 * and burn correlation applied); only CRITICAL and HIGH page. `prevPaged` is the
 * level kinds the last delivered full pass paged (plus 'run_failed' when the
 * previous run died). `fullPass` false (a pass that returned early) sends no
 * recoveries, because a kind it never evaluated has not cleared.
 * Returns `{ notices: [{ kind, label, urgent, recovery, text }], paged }`.
 */
export function planAlarmNotices(findings, { prevPaged = [], fullPass = true, stamp = '', kinds = ALARM_KINDS,
  prefix = ALARM_LABEL, rehearsal = false } = {}) {
  const groups = new Map()
  for (const f of findings || []) {
    if (f.severity !== S.CRITICAL && f.severity !== S.HIGH) continue
    if (!groups.has(f.kind)) groups.set(f.kind, [])
    groups.get(f.kind).push(f)
  }
  const notices = [], paged = []
  for (const [kind, list] of groups) {
    const urgent = isOneShotKind(kind, kinds) || list.some(f => f.urgent)
    const sev = list.some(f => f.severity === S.CRITICAL) ? S.CRITICAL : S.HIGH
    const head = `CBOB VAULTS${rehearsal ? ' (REHEARSAL)' : ''} ${sev} ${kind}: ${list.length} finding(s)${urgent ? ` at pass ${stamp}` : ''}`
    let body = '', shown = 0
    for (const f of list) {
      const line = `\n- ${f.detail}${f.signature ? ` [tx ${f.signature}]` : ''}`
      if (head.length + body.length + line.length > NOTICE_MAX_CHARS) break
      body += line; shown++
    }
    if (shown < list.length) body += `\n- ...and ${list.length - shown} more of this kind; the alarm log has every one.`
    const text = head + body
    notices.push({ kind, label: alarmLabel(kind, prefix), urgent, recovery: false, text: urgent ? text : defangForRouter(text) })
    if (!urgent) paged.push(kind)
  }
  if (fullPass) {
    for (const kind of new Set(prevPaged || [])) {
      if (paged.includes(kind) || isOneShotKind(kind, kinds)) continue
      notices.push({ kind, label: alarmLabel(kind, prefix), urgent: false, recovery: true,
        text: `CBOB vaults${rehearsal ? ' (REHEARSAL)' : ''}: ${kind} RECOVERED. The full pass at ${stamp} found none.` })
    }
  }
  return { notices, paged }
}
