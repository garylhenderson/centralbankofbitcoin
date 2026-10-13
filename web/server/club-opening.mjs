/** Custodial opening review. Context comes only from the encrypted server record. */
import { PublicKey } from '@solana/web3.js'
import { readRedemptionSnapshot } from '../src/lib/reads.mjs'
import { planRedemption, prepareOpening, LATE_CONSENT_ID, LATE_CONSENT, pressStopMessage } from '../src/lib/plan-redeem.mjs'
import { buildForWallet } from '../src/lib/tx.mjs'

function contextFor(context, owner, asset) {
  if (!context) return null
  if (context.version !== 1 || context.owner !== owner || context.asset !== asset ||
      !['known', 'seen', 'consented'].every(k => Array.isArray(context[k]) && context[k].every(x => typeof x === 'string'))) {
    throw new Error('The saved opening review is invalid. Review the vault again.')
  }
  return context
}
export async function planClubOpening({ profile, conn, ids, owner, asset, previous = null, confirming = null }) {
  const saved = contextFor(confirming?.openingContext || previous, owner, asset)
  if (confirming && !saved) throw new Error('This opening review predates the consent safeguards. Review the vault again.')
  const read = async (noPrior, dropStrays = false) => {
    const snapshot = await readRedemptionSnapshot(profile, conn, ids, owner, new PublicKey(asset), saved?.known || [])
    if (saved) Object.assign(snapshot, { known: new Set(saved.known), seen: new Set(saved.seen), consented: new Set(saved.consented) })
    Object.assign(snapshot, { noPrior, dropStrays })
    const plan = planRedemption(ids, snapshot)
    // Nested-vault rescue is optional, and remains available from that vault's page.
    plan.prior = plan.prior.filter(group => !group.optional)
    return { snapshot, plan }
  }
  let fresh, built = null
  if (confirming?.summary.stage === 'open') {
    const consented = new Set(saved.consented)
    if (!consented.has(LATE_CONSENT_ID)) throw new Error('Review the late-arrival acknowledgment before opening.')
    const result = await prepareOpening({ consented,
      replan: async ({ dropStrays }) => { fresh = await read(true, dropStrays); return fresh.plan },
      dryRun: async plan => { built = await buildForWallet(conn, plan.redemption, new PublicKey(owner)); return built.sim },
    })
    if (!result.ok) {
      if (result.stop === 'ack') throw new Error(pressStopMessage(result.newAcks, result.dropStrays) + ' Prepare a fresh review.')
      if (result.stop === 'refuse') throw new Error(result.plan.refuse.join(' '))
      if (result.stop === 'prior') throw new Error('The opening needs receiving accounts. Prepare and review the setup again.')
      throw new Error('The network dry run refused the opening. Nothing was signed. Review the vault again.')
    }
  } else {
    fresh = await read(false)
    if (!fresh.plan.prior.length) fresh = await read(true)
  }
  const { snapshot: s, plan: p } = fresh
  if (p.refuse.length) throw new Error(p.refuse.join(' '))
  const setup = p.prior[0], stage = setup ? 'opening_setup' : 'open'
  const acks = [...p.ack, { id: LATE_CONSENT_ID, text: LATE_CONSENT }]
  const openingContext = saved || {
    version: 1, owner, asset,
    known: [...new Set([...p.helperStrays, ...p.transferStrays])].sort(),
    seen: [...new Set([...s.pdaTokens.map(t => t.address), ...s.nested.map(n => n.address), ...(s.compressed || []).map(n => n.address)])].sort(),
    consented: [],
  }
  // During confirmation preserve the exact saved consent identity. A new quote
  // may add a genuinely new loss acknowledgment, which the member must accept.
  const context = confirming ? openingContext : { ...openingContext, consented: [...new Set([...openingContext.consented, ...acks.map(a => a.id)])].sort() }
  return { ixs: setup ? setup.map(x => x.ix) : p.redemption, built, stage, acks, openingContext: context,
    details: { vault_no: Number(s.record.mint_index) + 1, level: s.record.level,
      owed_sats: String(p.owedSats), claim: p.claim,
      reserves: s.pdaTokens.map(t => ({ address: t.address, mint: t.parsed?.mint || null, raw: String(t.parsed?.amount || 0) })),
      note: [...p.note, ...p.lateInfo, ...p.pressInfo, ...(s.nested.some(n => n.ourVault) ? ['A vault held inside can be rescued separately from its own vault page. This opening does not wait for that optional rescue.'] : [])],
      ...(setup ? { steps: setup.map(x => x.why) } : { destroyed: true }),
    },
  }
}
