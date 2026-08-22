/**
 * ONE READER FOR A TOKEN ACCOUNT, because there were six and they disagreed.
 *
 * ROUND 11. `alarm.mjs` guarded both of its reads with `data.length >= 72`.
 * `distribute.mjs` and `revenue.mjs` guarded none of their five. Every one of
 * those did `info.data.readBigUInt64LE(64)` behind nothing but `if (!info)`,
 * which separates ABSENT from PRESENT and never PRESENT from VALID — so a
 * present account with no data throws a RangeError instead of reading as
 * anything.
 *
 * That is reachable by a stranger for one lamport. A plain system transfer to a
 * vault's derived cbBTC ATA credits lamports to a 0-data, system-owned account;
 * the next daily run reaches it in the balance loop, throws, and NOBODY IS PAID.
 * It costs the attacker a transaction fee and it does not clear on its own.
 *
 * So: absent, foreign-owned, and malformed are each their own answer, and the
 * CALLER decides what each one means. That distinction is the point — the same
 * byte pattern is a per-vault nuisance in one place and a refusal to move money
 * in another, and a helper that returned a bare 0n could not express either.
 *
 * `state: 'ok'` is the ONLY state that carries a meaningful amount. In
 * particular an emptiness PROOF must demand it: an absent account is not an
 * empty one, and reading it as zero is how "someone else already split the
 * revenue" gets proven by an ATA that never existed.
 */

/** Classic SPL. cbBTC, GARY and GIRAFFISH are all Tokenkeg with no extensions,
 *  asserted against mainnet by scripts/probe-mainnet-facts.mjs. A Token-2022
 *  account therefore reads as FOREIGN here, deliberately: if one ever appears
 *  where we expect cbBTC, that is a fault to report, not a balance to trust. */
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

/** Amount lives at offset 64 and needs 8 bytes; a real account is 165. 72 is the
 *  floor the on-chain programs and the alarm already use — kept identical rather
 *  than introducing a third standard for the same question. */
export const MIN_TOKEN_ACCOUNT_LEN = 72

export function readTokenAccount(info) {
  if (!info) return { state: 'absent', amount: 0n }
  if (String(info.owner) !== TOKEN_PROGRAM_ID) return { state: 'foreign', amount: 0n }
  if (!info.data || info.data.length < MIN_TOKEN_ACCOUNT_LEN) return { state: 'malformed', amount: 0n }
  return { state: 'ok', amount: info.data.readBigUInt64LE(64) }
}

/** For the places that must MOVE MONEY against this number. Anything but a
 *  readable token account is a fault, named, before a lamport goes anywhere. */
export function requireTokenAmount(info, what, addr) {
  const r = readTokenAccount(info)
  if (r.state === 'ok') return r.amount
  const why = { absent: 'does not exist', foreign: 'is not owned by the SPL Token program',
    malformed: `is too short to be a token account (${info?.data?.length ?? 0} bytes)` }[r.state]
  throw new Error(`${what} at ${addr} ${why}. That is a configuration fault or a poisoned account, `
    + 'not a zero balance: refusing to treat it as one.')
}

/** True only for a genuine, readable, EMPTY token account. */
export function isProvablyEmpty(info) {
  const r = readTokenAccount(info)
  return r.state === 'ok' && r.amount === 0n
}
