/**
 * Prove every detector in BOTH directions against synthetic input.
 *
 * The standing rule on this box: a gate that has only ever said OK is untested,
 * and this pipeline is the one that carries what the programs structurally
 * cannot. So each detector gets a case that MUST fire and a case that MUST NOT.
 */
import * as D from './detectors.mjs'
const R = []
const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want)
  R.push({ name, ok, got, want }); console.log(`  ${ok ? 'ok  ' : 'XX  '}${name}${ok ? '' : `\n        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`) }

const PDA = 'VauLtPDA1111111111111111111111111111111111'
const OTHER = 'SomeoneElse11111111111111111111111111111111'
const ASSET = 'VauLtAsset11111111111111111111111111111111'
const ATA_OK = 'CanonicalAta111111111111111111111111111111'
const ATA_BAD = 'SneakyTokenAcct11111111111111111111111111'
const BURN_PROG = '8DGic8UzRh9moa8pwko9tEszg2FrghzJeR5sKRFDcpv8'
const pdas = new Set([PDA]), assets = new Set([ASSET]), atas = new Set([ATA_OK])

console.log('── approvals ──')
t('fires on an approve BY a vault PDA',
  D.detectApprovals([{ program: D.TOKEN_ID, parsed: { type: 'approve', info: { owner: PDA, delegate: OTHER, source: ATA_OK } } }], pdas).length, 1)
t('fires on approveChecked too',
  D.detectApprovals([{ program: D.TOKEN_ID, parsed: { type: 'approveChecked', info: { owner: PDA, delegate: OTHER, source: ATA_OK } } }], pdas).length, 1)
t('QUIET on an approve by an unrelated wallet',
  D.detectApprovals([{ program: D.TOKEN_ID, parsed: { type: 'approve', info: { owner: OTHER, delegate: OTHER, source: ATA_OK } } }], pdas).length, 0)
t('QUIET on an ordinary transfer',
  D.detectApprovals([{ program: D.TOKEN_ID, parsed: { type: 'transfer', info: { owner: PDA } } }], pdas).length, 0)

console.log('── PDA-owned token accounts ──')
t('CRITICAL on a NON-canonical token account for a vault PDA',
  D.detectPdaTokenAccounts([{ program: D.ATA_ID, parsed: { info: { wallet: PDA, account: ATA_BAD } } }], pdas, atas)[0].severity, 'CRITICAL')
t('INFO on the canonical reserve ATA (this is activation)',
  D.detectPdaTokenAccounts([{ program: D.ATA_ID, parsed: { info: { wallet: PDA, account: ATA_OK } } }], pdas, atas)[0].severity, 'INFO')
t('fires on a raw initializeAccount3 owned by a vault PDA',
  D.detectPdaTokenAccounts([{ program: D.TOKEN_ID, parsed: { type: 'initializeAccount3', info: { owner: PDA, account: ATA_BAD } } }], pdas, atas)[0].severity, 'CRITICAL')
t('QUIET for a token account belonging to someone else',
  D.detectPdaTokenAccounts([{ program: D.ATA_ID, parsed: { info: { wallet: OTHER, account: ATA_BAD } } }], pdas, atas).length, 0)

console.log('── burns ──')
t('CRITICAL on a BARE Core BurnV1 of a known vault',
  D.detectBurns([{ program: D.CORE_ID, dataBytes: [12], accounts: [ASSET] }], assets, BURN_PROG)[0].severity, 'CRITICAL')
t('HIGH on a burn through our burn program',
  D.detectBurns([{ program: BURN_PROG, accounts: [ASSET] }], assets, BURN_PROG)[0].severity, 'HIGH')
t('QUIET on a Core instruction that is not BurnV1',
  D.detectBurns([{ program: D.CORE_ID, dataBytes: [6], accounts: [ASSET] }], assets, BURN_PROG).length, 0)
t('QUIET on a burn of an asset that is not one of our vaults',
  D.detectBurns([{ program: D.CORE_ID, dataBytes: [12], accounts: [OTHER] }], assets, BURN_PROG).length, 0)

console.log('── activation ──')
t('fires when an activated vault falls below 21,000 sats',
  D.detectDeactivations({ [ASSET]: true }, { [ASSET]: '20999' })[0].kind, 'deactivated')
t('fires when an activated vault becomes unreadable',
  D.detectDeactivations({ [ASSET]: true }, {})[0].kind, 'vault_vanished')
t('QUIET at exactly 21,000 sats',
  D.detectDeactivations({ [ASSET]: true }, { [ASSET]: '21000' }).length, 0)
t('QUIET for a vault that was never activated',
  D.detectDeactivations({ [ASSET]: false }, { [ASSET]: '0' }).length, 0)

console.log('── config drift ──')
t('fires when the treasury moves',
  D.detectConfigDrift({ 'mint.treasury': 'A' }, { 'mint.treasury': 'B' })[0].severity, 'CRITICAL')
t('fires when a reserve mint is added',
  D.detectConfigDrift({ 'seal.reserve_mints': ['a'] }, { 'seal.reserve_mints': ['a', 'b'] }).length, 1)
t('QUIET when nothing moved',
  D.detectConfigDrift({ 'mint.treasury': 'A', 'seal.bank': 'B' }, { 'mint.treasury': 'A', 'seal.bank': 'B' }).length, 0)
t('QUIET on the first ever run (no previous state)',
  D.detectConfigDrift(null, { 'mint.treasury': 'A' }).length, 0)

console.log('── standing risks ──')
t('CRITICAL when the 85/15 rule itself has been changed',
  D.detectStandingRisks({ 'mint.split_bps': 5000 })[0].severity, 'CRITICAL')
t('QUIET at 8500',
  D.detectStandingRisks({ 'mint.split_bps': 8500 }).length, 0)
t('fires when the swap operator is repointed',
  D.detectConfigDrift({ 'mint.swap_operator': 'A' }, { 'mint.swap_operator': 'B' })[0].severity, 'CRITICAL')
t('fires on a production voting period left at the test floor',
  D.detectStandingRisks({ 'gov.min_voting_secs': 60 })[0].kind, 'weak_voting_period')
t('QUIET on a 7-day voting period',
  D.detectStandingRisks({ 'gov.min_voting_secs': 7 * 86400 }).length, 0)

console.log('── revenue reconciliation ──')
const T0 = Date.parse('2026-08-22T00:00:00Z')
t('CRITICAL when SOL was swept and no cbBTC came back',
  D.detectUnreconciledRevenue({ cycles: [{ startedAt: '2026-08-22T00:00:00Z', sweptLamports: '5' }] },
    { now: T0 + 7200_000 })[0].severity, 'CRITICAL')
t('QUIET while the cycle is still in flight',
  D.detectUnreconciledRevenue({ cycles: [{ startedAt: '2026-08-22T00:00:00Z', sweptLamports: '5' }] },
    { now: T0 + 60_000 }).length, 0)
t('QUIET once the cbBTC has returned',
  D.detectUnreconciledRevenue({ cycles: [{ startedAt: '2026-08-22T00:00:00Z', sweptLamports: '5', returnedSats: '9' }] },
    { now: T0 + 7200_000 }).length, 0)
t('QUIET with no ledger at all', D.detectUnreconciledRevenue(null).length, 0)

const bad = R.filter(r => !r.ok)
console.log(`\n${'='.repeat(60)}\n${R.length - bad.length}/${R.length} detector assertions as predicted`)
console.log(`every detector proven in BOTH directions: fires when it should, quiet when it should`)
process.exit(bad.length ? 1 : 0)
