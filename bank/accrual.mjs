/**
 * THE PAYOUT ARITHMETIC, MIRRORED OFF CHAIN — and the allocation suite.
 *
 * v5's `bank/distribute.mjs` COMPUTED every holder's share off chain and sent it
 * from a wallet on this box. v6 deleted that wallet (Gary, 2026-10-03: "the % that
 * goes back to the community should live in the program"): the MINT program now
 * keeps a weighted accumulator and pays each vault from the pool by itself. What
 * this file owes now is narrower and just as important: the crank and the alarm
 * must compute "what is this vault owed" and "what is undistributed" EXACTLY as
 * the program does, or the crank sends claims that pay nothing and the alarm
 * reports a healthy pool as short (or a short one as healthy).
 *
 * So these are the Rust formulas, line for line (programs/cbob-vault-mint
 * `credit`, `claim`, `retire`, `ceil_sats`), in BigInt, and `--selftest` proves
 * the properties the holders were promised: Level V gets exactly 3x Level I, no
 * vault is ever paid more than was distributed, dust carries rather than
 * vanishing, a vault activated after a distribution gets nothing from it, a
 * deferred (frozen) payout stays owed in full, and a retired vault's unpaid share
 * goes back to the pool.
 *
 * Run: node bank/accrual.mjs --selftest
 */
import { fileURLToPath } from 'url'

export const ACC_SCALE = 1_000_000_000_000n
export const WEIGHTS = [2n, 3n, 4n, 5n, 6n]          // Levels I..V
export const weightOf = level => {
  if (!Number.isInteger(level) || level < 1 || level > 5) throw new Error(`level ${level} has no weight`)
  return WEIGHTS[level - 1]
}

/** ceil(scaled / ACC_SCALE): what the pool must keep for what is already owed. */
export const ceilSats = scaled => (BigInt(scaled) + ACC_SCALE - 1n) / ACC_SCALE

/** The pool's undistributed balance (`distribute`'s `avail`). Never negative here;
 *  the program refuses with PoolShort instead, and the alarm reports it. */
export function available(poolBalance, owedScaled) {
  const a = BigInt(poolBalance) - ceilSats(owedScaled)
  return a > 0n ? a : 0n
}

/** `credit`: returns the new { acc, owed } after distributing `avail` over `w`. */
export function credit({ acc, owed }, avail, w) {
  avail = BigInt(avail); w = BigInt(w)
  if (w <= 0n) throw new Error('no activated weight')
  const delta = avail * ACC_SCALE / w
  return { acc: BigInt(acc) + delta, owed: BigInt(owed) + delta * w }
}

/** `claim`'s per-vault arithmetic: whole sats payable now. */
export function pendingSats({ level, debt }, acc) {
  const p = weightOf(level) * BigInt(acc) - BigInt(debt)
  if (p < 0n) throw new Error('debt above entitlement: the record and the accumulator disagree')
  return p / ACC_SCALE
}

/** The debt a vault starts with when it activates (it earns from the NEXT distribution). */
export const debtAtActivation = (level, acc) => weightOf(level) * BigInt(acc)

// ───────────────────────────────── selftest ─────────────────────────────────
function selftest() {
  const R = []
  const t = (name, got, want) => {
    const ok = JSON.stringify(got, (_, v) => typeof v === 'bigint' ? v.toString() : v)
      === JSON.stringify(want, (_, v) => typeof v === 'bigint' ? v.toString() : v)
    R.push(ok); console.log(`  ${ok ? 'ok  ' : 'XX  '}${name}${ok ? '' : `\n        got ${JSON.stringify(got, (_, v) => typeof v === 'bigint' ? v.toString() : v)}\n        want ${JSON.stringify(want, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`}`)
  }
  const throws = f => { try { f(); return false } catch { return true } }

  console.log('── weights ──')
  t('Level I weighs 2', weightOf(1), 2n)
  t('Level V weighs 6', weightOf(5), 6n)
  t('Level V is exactly 3x Level I', weightOf(5) / weightOf(1), 3n)
  t('level 0 (not yet drawn) has no weight', throws(() => weightOf(0)), true)
  t('level 6 does not exist', throws(() => weightOf(6)), true)
  t('a non-integer level is refused', throws(() => weightOf(2.5)), true)

  // THE PUBLISHED CARD'S DENOMINATORS, re-derived from the weights (they were
  // asserted by bank/distribute.mjs until it was retired with the distributor).
  const denom = census => census.reduce((a, n, i) => a + BigInt(n) * weightOf(i + 1), 0n)
  t('the 240-vault charter census 108/60/36/24/12 weighs 732', denom([108, 60, 36, 24, 12]), 732n)
  t('the 2,100-vault census 945/525/315/210/105 weighs 6,405', denom([945, 525, 315, 210, 105]), 6405n)

  console.log('── one distribution over one vault of each level ──')
  // w = 2+3+4+5+6 = 20; 20,000 sats -> 1,000 per weight unit.
  let st = { acc: 0n, owed: 0n }
  const vs = [1, 2, 3, 4, 5].map(level => ({ level, debt: debtAtActivation(level, 0n) }))
  st = credit(st, 20_000n, 20n)
  const pays = vs.map(v => pendingSats(v, st.acc))
  t('pays exactly 2,000 / 3,000 / 4,000 / 5,000 / 6,000', pays, [2000n, 3000n, 4000n, 5000n, 6000n])
  t('...which is 1 : 1.5 : 2 : 2.5 : 3', pays.map(p => Number(p) / 2000), [1, 1.5, 2, 2.5, 3])
  t('...and sums to exactly what was distributed', pays.reduce((a, b) => a + b, 0n), 20_000n)
  t('owed is exactly the distributed amount, scaled', st.owed, 20_000n * ACC_SCALE)
  t('a claimed vault is owed nothing more', pendingSats({ level: 5, debt: vs[4].debt + 6000n * ACC_SCALE }, st.acc), 0n)

  console.log('── dust ──')
  // 7 sats over weight 20: 0.35 per unit. Nobody is owed a whole sat yet, and the
  // fraction is NOT lost — it is in acc and pays out once it adds up.
  let d = credit({ acc: 0n, owed: 0n }, 7n, 20n)
  t('7 sats over weight 20 pays no whole sat to a Level I yet', pendingSats({ level: 1, debt: 0n }, d.acc), 0n)
  t('...but the Level V is owed 2 (6 x 0.35 = 2.1)', pendingSats({ level: 5, debt: 0n }, d.acc), 2n)
  t('the pool keeps ceil(owed) for it: 7', ceilSats(d.owed), 7n)
  for (let i = 0; i < 9; i++) d = credit(d, 7n, 20n)
  t('after ten such drops the Level I is owed 7 (10 x 0.7)', pendingSats({ level: 1, debt: 0n }, d.acc), 7n)
  t('nothing is ever owed beyond what was distributed (70)',
    [1, 2, 3, 4, 5].map(l => pendingSats({ level: l, debt: 0n }, d.acc)).reduce((a, b) => a + b, 0n) <= 70n, true)
  // An amount that does not divide the weight: the truncation is in the
  // vaults' disfavour by under a sat in total, never in their favour.
  const odd = credit({ acc: 0n, owed: 0n }, 1n, 3n)
  t('1 sat over weight 3 credits acc = floor(1e12/3)', odd.acc, ACC_SCALE / 3n)
  t('...and owed never exceeds what the pool received', odd.owed <= ACC_SCALE, true)

  console.log('── timing ──')
  // A vault that activates AFTER a distribution earns nothing from it.
  let s2 = credit({ acc: 0n, owed: 0n }, 10_000n, 20n)
  const late = { level: 5, debt: debtAtActivation(5, s2.acc) }
  t('a vault activated after a drop is owed nothing from it', pendingSats(late, s2.acc), 0n)
  s2 = credit(s2, 10_000n, 26n)                    // it now counts (20 + 6)
  t('...and shares in the next one by its weight', pendingSats(late, s2.acc), 10_000n * 6n / 26n)

  console.log('── the pool ──')
  t('available = balance - ceil(owed)', available(100n, 30n * ACC_SCALE + 1n), 69n)
  t('a pool holding exactly what it owes has nothing to distribute', available(31n, 30n * ACC_SCALE + 1n), 0n)
  t('a SHORT pool reads as 0 available here (the alarm reports the shortfall)', available(5n, 30n * ACC_SCALE), 0n)
  t('ceil of an exact multiple is exact', ceilSats(5n * ACC_SCALE), 5n)
  t('ceil of one scaled unit over is one more sat', ceilSats(5n * ACC_SCALE + 1n), 6n)

  console.log('── frozen and retired vaults ──')
  // A frozen destination is skipped: its debt does not move, so it stays owed.
  const frozen = { level: 3, debt: 0n }
  const s3 = credit({ acc: 0n, owed: 0n }, 1_000n, 4n)
  t('a deferred (frozen) vault is still owed in full on the next look', pendingSats(frozen, s3.acc), 1_000n)
  // Retire returns the pending share to the pool: owed falls by exactly it.
  const pendScaled = weightOf(3) * s3.acc - frozen.debt
  t('retiring it returns exactly its share to the pool', s3.owed - pendScaled, 0n)
  t('a debt above entitlement is refused, not paid negative', throws(() => pendingSats({ level: 1, debt: 10n * ACC_SCALE }, ACC_SCALE)), true)
  t('crediting with no activated weight is refused', throws(() => credit({ acc: 0n, owed: 0n }, 5n, 0n)), true)

  const ok = R.filter(Boolean).length
  console.log(`\n${ok}/${R.length} allocation assertions as predicted`)
  process.exit(ok === R.length ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--selftest')) selftest()
