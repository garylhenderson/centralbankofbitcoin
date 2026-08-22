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
 * A vault that STOPS reading as activated.
 *
 * Activation is deliberately off-chain (>= 21,000 sats of cbBTC), so nothing
 * on-chain notices it lapsing. A vault that was activated and no longer is has
 * either been redeemed, drained through a delegate, or had its reserve moved by
 * a route we did not expect — and all three are worth knowing about the same day.
 */
export function detectDeactivations(prev, current, unreadable = []) {
  const out = []
  const unread = new Set(unreadable)
  for (const a of unread) {
    // The file header says a read that fails is an ALARM, never a pass. This
    // used to be `catch { bal = '0' }`, which turned one RPC hiccup into a false
    // "deactivated" AND wrote the vault down as inactive — after which a REAL
    // drain on the next pass was skipped as "it was already inactive".
    out.push({ kind: 'vault_unreadable', severity: S.HIGH, asset: a,
      detail: `could not read the cbBTC balance of vault ${a}. Its activation is UNKNOWN this pass, not zero.` })
  }
  for (const [asset, wasActive] of Object.entries(prev || {})) {
    if (!wasActive) continue
    if (unread.has(asset)) continue
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
    ['mint.bank_treasury', S.CRITICAL, 'the Bank 15% lands here'],
    ['mint.split_bps', S.CRITICAL, 'THE 85/15 RULE ITSELF'],
    ['mint.swap_operator', S.CRITICAL, 'the only address SOL may be swept to'],
    ['mint.sol_reserve_lamports', S.HIGH, 'what the revenue address keeps for fees'],
    ['mint.paused', S.HIGH, 'the sale kill switch'],
    ['gov.quorum_bps', S.HIGH, 'the bar a vote must clear'],
    ['gov.threshold_bps', S.HIGH, 'the YES share a vote must clear'],
    // Round 6. A governance rotation is now ARMED first and applied a week
    // later, and this is the week. If this ever reads as anything but the
    // default pubkey, somebody has scheduled a change to who may set a round.
    ['mint.pending_governance', S.CRITICAL, 'A GOVERNANCE ROTATION IS ARMED'],
    ['mint.pending_governance_at', S.CRITICAL, 'when that rotation becomes applicable'],
    ['mint.max_sweep_lamports', S.CRITICAL, 'the on-chain ceiling on one sweep'],
    ['mint.sweep_cooldown_secs', S.CRITICAL, 'without which the ceiling is not a ceiling'],
    ['gov.version', S.HIGH, 'the layout every offset read below depends on'],
    ['seal.version', S.HIGH, 'ditto'],
    ['mint.version', S.HIGH, 'ditto'],
    // BURN's own config was not watched at all — the co-signer on the one
    // irreversible path in the system.
    ['burn.bank', S.CRITICAL, 'co-signs every burn'],
    ['burn.admin', S.HIGH, 'can rotate the burn bank'],
    // A program upgrade can repoint revenue, unseal a vault, or change any rule
    // here without touching a single config byte. Nothing watched this, while
    // the SPEC says the upgrade authority is the thing standing between "no key
    // can unseal a vault" and a false statement.
    ['prog.seal.upgrade_authority', S.CRITICAL, 'can replace the SEAL program'],
    ['prog.mint.upgrade_authority', S.CRITICAL, 'can replace the MINT program'],
    ['prog.burn.upgrade_authority', S.CRITICAL, 'can replace the BURN program'],
    ['prog.gov.upgrade_authority', S.CRITICAL, 'can replace the GOV program'],
    ['prog.seal.hash', S.CRITICAL, 'THE DEPLOYED SEAL BYTES CHANGED'],
    ['prog.mint.hash', S.CRITICAL, 'THE DEPLOYED MINT BYTES CHANGED'],
    ['prog.burn.hash', S.CRITICAL, 'THE DEPLOYED BURN BYTES CHANGED'],
    ['prog.gov.hash', S.CRITICAL, 'THE DEPLOYED GOV BYTES CHANGED'],
    // Royalties, freeze rules and anything else on the collection live in a
    // plugin blob this pipeline has no parser for. Hash it: we do not need to
    // read a change to be certain one happened.
    ['collection.hash', S.CRITICAL, 'the collection account (royalties + plugins) changed'],
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
  if (cur['mint.split_bps'] !== undefined && Number(cur['mint.split_bps']) !== 8500) {
    out.push({ kind: 'split_not_85_15', severity: S.CRITICAL,
      detail: `mint.split_bps is ${cur['mint.split_bps']}, not 8500. The 85/15 rule is what holders were promised.` })
  }
  if (cur['mint.paused'] === 1) {
    out.push({ kind: 'sale_paused', severity: S.INFO, detail: 'minting is PAUSED (redemption and burn are unaffected)' })
  }
  const minDays = opts.minVotingDays ?? 3
  const v = cur['gov.min_voting_secs']
  if (v !== undefined && v !== null && Number(v) < minDays * 86400) {
    out.push({ kind: 'weak_voting_period', severity: S.HIGH,
      detail: `gov.min_voting_secs is ${v}s — below the ${minDays}-day production minimum. The code floor exists only so the execute path is testable.` })
  }
  // A governance rotation is armed. This is CRITICAL on its face and not only as
  // drift, because the whole value of the timelock is that somebody looks during
  // the week it is ticking — a finding that fires once, on the pass it changed,
  // is a finding that fires while everyone is asleep.
  const pg = cur['mint.pending_governance']
  if (pg && pg !== DEFAULT_PUBKEY) {
    out.push({ kind: 'governance_rotation_armed', severity: S.CRITICAL,
      detail: `mint.pending_governance is ${pg}, applicable from unix ${cur['mint.pending_governance_at']}. Once applied, that key decides who may set a round and can co-sign a treasury rotation. Cancel it with cancel_pending_governance if it is not yours.` })
  }
  // A cap with no cooldown is not a cap: the same caller just puts N sweeps in
  // one transaction. Either being absent means the on-chain bound is decorative.
  const cap = cur['mint.max_sweep_lamports'], cool = cur['mint.sweep_cooldown_secs']
  if (cap !== undefined && (BigInt(cap) === 0n || Number(cool) <= 0)) {
    out.push({ kind: 'sweep_bound_ineffective', severity: S.CRITICAL,
      detail: `sweep bound is not a bound: max_sweep_lamports=${cap}, sweep_cooldown_secs=${cool}. sweep_sol_for_swap is permissionless, so without BOTH the whole revenue balance can be pushed to the operator key in one transaction.` })
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
    // A cycle that recorded an INTENT and never a confirmed sweep is the worst
    // case, not an exempt one: `revenue.mjs` writes `sweptLamports` only after
    // the send confirms, so a confirmation timeout on a transaction that
    // actually landed used to leave a row this loop skipped forever.
    if (swept === 0n) continue
    if (age < graceMs) continue          // a cycle in flight is not a finding
    const returned = BigInt(c.returnedSats ?? 0)
    // `String(0n)` is `'0'`, which is TRUTHY. `if (c.returnedSats) continue`
    // therefore marked a cycle that returned NOTHING as reconciled. Compare the
    // number, never the string.
    if (returned === 0n) {
      out.push({ kind: 'unreconciled_swap', severity: S.CRITICAL,
        detail: `${swept} lamports left the revenue address at ${c.startedAt} and NO cbBTC came back (${Math.round(age / 60000)} min ago)${c.sweptLamports ? '' : ' — and the sweep itself was never confirmed into the ledger, so the amount is the intent'}` })
      continue
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
      detail: `vault ${asset} owns token account ${address} (${amount} units) that is NOT a canonical reserve ATA. burn_vault checks only DECLARED accounts, so this balance is destroyed with the vault unless someone declares it. Do not co-sign a burn of this vault until it is resolved.` })
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
 * BLIND TO: a legitimate redemption, which looks identical. That is why this is
 * HIGH and not CRITICAL: it is "somebody's reserve moved", to be read against the
 * open/close stamp, not an accusation.
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
        detail: `vault ${asset} reserve fell ${b - a} sats (${b} -> ${a}). Expected if it was redeemed; otherwise it is the drain the seal exists to prevent.` })
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
export function detectIndexShortfall(mintedTotal, live, burnt) {
  const out = []
  if (mintedTotal === undefined || mintedTotal === null) return out
  const seen = BigInt(live) + BigInt(burnt)
  const total = BigInt(mintedTotal)
  if (seen < total) {
    out.push({ kind: 'index_short_of_chain', severity: S.CRITICAL,
      detail: `the collection index returned ${seen} vaults (${live} live + ${burnt} burnt) but the chain says ${total} have been minted. The index is incomplete; do not distribute or reconcile against it.` })
  }
  return out
}

export const SEVERITY = S
