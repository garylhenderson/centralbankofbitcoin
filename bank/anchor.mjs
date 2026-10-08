/**
 * PIN AN ANCHOR ACCOUNT BEFORE READING RAW OFFSETS. Declared once.
 *
 * ROUND 12. Round 11 taught `alarm.mjs`'s `readConfigs` to verify the owning
 * program and the account discriminator before taking byte offsets — and left
 * the SAME shape in `bank/revenue.mjs` and `bank/distribute.mjs`, the two jobs
 * that actually move money, each with its own copy of the MintConfig offset
 * map and nothing but `if (!acc)` in front of it. One of three sites, again.
 *
 * It is not a theft path today: the address is a PDA of the MINT program, so a
 * stranger cannot plant a substitute there. It is a SILENCE path. A MINT
 * upgrade that reorders `MintConfig` makes both jobs misread — a wrong
 * treasury, a wrong operator, a wrong `minted_total` divisor — and carry on
 * quietly, where the same upgrade against a pinned reader is a loud refusal.
 * The version byte is the field that changes when the layout does, and reading
 * it is the difference between wrong answers and no answer.
 */
import { createHash } from 'crypto'

/** ACCOUNT discriminators use a different preimage from instructions:
 *  sha256("account:<Struct>")[..8], never sha256("global:<name>"). */
export const accountDiscriminator = name =>
  createHash('sha256').update(`account:${name}`).digest().subarray(0, 8)

/** Returns the account's data, or throws with what was wrong. `version` is the
 *  layout this caller's offsets were written against; an unknown one is a
 *  refusal, because offsets are only meaningful for the layout they describe. */
/** ROUND 41-42 (drift A1-A3): anyone can send lamports to an address that a
 *  program creates LATER (a config PDA, a token account). That leaves a
 *  System-owned account with no data, which Anchor's init and the ATA create
 *  both still land on (suite R31.W2a, R34.G2). It is NOT CREATED YET, never a
 *  foreign owner: reading it as foreign made every alarm pass throw. */
export function isSystemDust(acc) {
  return !!acc && String(acc.owner?.toBase58?.() ?? acc.owner) === '11111111111111111111111111111111' && (acc.data?.length ?? 0) === 0
}

export function pinnedAccountData(acc, { program, struct, version = 1, what = 'config' }) {
  if (!acc || isSystemDust(acc)) return null  // absent (or dusted, not created yet) is the caller's to interpret
  if (!acc.owner || acc.owner.toBase58() !== program.toBase58()) {
    throw new Error(`${what} is owned by ${acc.owner?.toBase58?.() || 'nobody'}, not ${program.toBase58()}. `
      + 'Refusing to read byte offsets out of an account that is not the one this code understands.')
  }
  if (acc.data.length < 9) throw new Error(`${what} is ${acc.data.length} bytes — too short to be an Anchor account.`)
  const want = accountDiscriminator(struct)
  if (!acc.data.subarray(0, 8).equals(want)) {
    throw new Error(`${what} carries discriminator ${acc.data.subarray(0, 8).toString('hex')}, not `
      + `${want.toString('hex')} (account:${struct}). This is not the account this code was written for.`)
  }
  if (acc.data[8] !== version) {
    throw new Error(`${what} is layout version ${acc.data[8]}; this code reads version ${version}. `
      + 'Every byte offset below would be wrong, so it refuses rather than reporting wrong numbers.')
  }
  return acc.data
}
