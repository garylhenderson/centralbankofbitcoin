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

/**
 * ANY approve against a vault-owned token account.
 *
 * Why it matters: a delegate approved during a legitimate thaw SURVIVES the
 * re-seal, and the Token program will honour it later with no Execute, no Bank
 * and no thaw — draining a vault that still reads as sealed and full. The seal
 * program refuses this on the canonical reserve ATAs; a NON-ATA token account is
 * invisible to it. That gap is exactly this detector.
 *
 * BLIND TO: an approve inside a program whose CPI we cannot parse, and any
 * approve on an account whose owner we have not resolved to a vault PDA.
 */
export function detectApprovals(ixs, pdaSet) {
  const out = []
  for (const ix of ixs) {
    if (ix.program !== TOKEN_ID && ix.program !== TOKEN22_ID) continue
    const t = ix.parsed?.type
    if (t !== 'approve' && t !== 'approveChecked') continue
    const info = ix.parsed?.info || {}
    if (!pdaSet.has(info.owner)) continue
    out.push({ kind: 'approve', severity: S.CRITICAL, pda: info.owner,
      detail: `delegate ${info.delegate} approved on ${info.source} by vault PDA ${info.owner}` })
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
 * ANY burn of a vault, by any route.
 *
 * Core's BurnV1 is available to the owner directly and CANNOT be prevented while
 * the vault stays freely transferable (measured: PermanentFreezeDelegate blocks
 * transfer not burn; FreezeDelegate blocks both and kills resale). A bare burn
 * orphans the contents permanently. So every burn is worth a human look, whether
 * it went through our burn program or straight to Core.
 */
export function detectBurns(ixs, assetSet, burnProgramId) {
  const out = []
  for (const ix of ixs) {
    if (ix.program === burnProgramId) {
      out.push({ kind: 'burn_via_program', severity: S.HIGH, asset: ix.accounts?.[0] ?? null,
        detail: `burn_vault invoked on ${ix.accounts?.[0] ?? 'unknown'}` })
      continue
    }
    if (ix.program !== CORE_ID) continue
    if (ix.dataBytes?.[0] !== IX_BURN_V1) continue
    const asset = ix.accounts?.[0]
    if (!assetSet.has(asset)) continue
    out.push({ kind: 'bare_core_burn', severity: S.CRITICAL, asset,
      detail: `BARE Core BurnV1 on vault ${asset} — did NOT go through burn_vault, so nothing checked the contents` })
  }
  return out
}

/**
 * A vault that STOPS reading as activated.
 *
 * Activation is deliberately off-chain (>= 21,000 sats of cbBTC), so nothing
 * on-chain notices it lapsing. A vault that was activated and no longer is has
 * either been redeemed, drained through a delegate, or had its reserve moved by
 * a route we did not expect — and all three are worth knowing about the same day.
 */
export function detectDeactivations(prev, current) {
  const out = []
  for (const [asset, wasActive] of Object.entries(prev || {})) {
    if (!wasActive) continue
    const bal = current[asset]
    if (bal === undefined) {
      out.push({ kind: 'vault_vanished', severity: S.CRITICAL, asset,
        detail: `vault ${asset} was activated and is no longer readable at all` })
      continue
    }
    if (BigInt(bal) < ACTIVATION_SATS) {
      out.push({ kind: 'deactivated', severity: S.HIGH, asset,
        detail: `vault ${asset} fell below activation: ${bal} < ${ACTIVATION_SATS} sats` })
    }
  }
  return out
}

/**
 * Config drift on the levers this round's audit showed actually matter.
 * Rotating the treasury moves the holders' 85%; rotating governance decides who
 * may set a round; a short voting period is how a coordinated minority carries a
 * vote nobody else saw.
 */
export function detectConfigDrift(prev, cur) {
  const out = []
  if (!prev) return out
  const watch = [
    ['mint.treasury', S.CRITICAL, 'the 85% flows here'],
    ['mint.governance', S.CRITICAL, 'decides who may set a round'],
    ['mint.admin', S.HIGH, 'holds the wiring'],
    ['mint.max_supply', S.CRITICAL, 'the lifetime supply promise'],
    ['seal.bank', S.CRITICAL, 'co-signs every redemption'],
    ['seal.admin', S.HIGH, 'can rotate the bank'],
    ['seal.reserve_mints', S.HIGH, 'drives every on-chain emptiness proof'],
    ['gov.min_voting_secs', S.HIGH, 'must be DAYS in production, not the floor'],
    ['gov.quorum_bps', S.HIGH, 'the bar a vote must clear'],
    ['gov.threshold_bps', S.HIGH, 'the YES share a vote must clear'],
  ]
  for (const [k, severity, why] of watch) {
    const a = JSON.stringify(prev[k] ?? null), b = JSON.stringify(cur[k] ?? null)
    if (a !== b) out.push({ kind: 'config_drift', severity, detail: `${k}: ${a} -> ${b}  (${why})` })
  }
  return out
}

/** Things that are wrong on their face, independent of any change. */
export function detectStandingRisks(cur, opts = {}) {
  const out = []
  const minDays = opts.minVotingDays ?? 3
  const v = cur['gov.min_voting_secs']
  if (v !== undefined && v !== null && Number(v) < minDays * 86400) {
    out.push({ kind: 'weak_voting_period', severity: S.HIGH,
      detail: `gov.min_voting_secs is ${v}s — below the ${minDays}-day production minimum. The code floor exists only so the execute path is testable.` })
  }
  return out
}

export const SEVERITY = S
