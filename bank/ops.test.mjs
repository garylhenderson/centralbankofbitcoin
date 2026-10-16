import test from 'node:test'
import assert from 'node:assert/strict'
import { planTopup, DAY_CAP } from './topup-policy.mjs'
import { guardedAttempt, WorkerDeferred, payerLease } from './guarded-send.mjs'
import { mintFailureCode, BENIGN } from './crank.mjs'
import { classifySendFailure } from './swap.mjs'
import { alertKey } from './ops-notify.mjs'

const input = () => ({ balances: { source: 500000000, crank: 0, operator: 0 }, attempts: [], day: '2026-10-16', fee: 12500 })
test('initial allocation funds only the two operating roles and keeps reserve plus fee', () => {
  const p = planTopup(input())
  assert.deepEqual(p.transfers, [{ role: 'crank', lamports: 200000000 }, { role: 'operator', lamports: 50000000 }])
  assert.equal(p.total, DAY_CAP)
  assert.equal(p.reserve_after, 249987500)
})
test('threshold equality is idle; external overfunding cannot cause a negative transfer', () => {
  for (const crank of [50000000, 200000000, 2000000000]) {
    assert.equal(planTopup({ ...input(), balances: { source: 250000000, crank, operator: 25000000 } }).status, 'idle')
  }
})
test('refill is to target, never a fixed grant', () => {
  const p = planTopup({ ...input(), balances: { source: 250000000, crank: 49999999, operator: 26000000 } })
  assert.deepEqual(p.transfers, [{ role: 'crank', lamports: 150000001 }])
})
test('same-day successful seed consumes the cap; next UTC day resets only budget', () => {
  const a = { day: '2026-10-16', total: DAY_CAP, outcome: { status: 'landed' } }
  assert.equal(planTopup({ ...input(), attempts: [a] }).reason, 'daily_cap')
  assert.equal(planTopup({ ...input(), attempts: [a], day: '2026-10-17' }).status, 'ready')
  for (const status of [null, 'unknown', 'pending']) {
    assert.throws(() => planTopup({ ...input(), attempts: [{ ...a, outcome: status && { status } }], day: '2026-10-17' }), /Unresolved/)
  }
})
test('failed/expired attempts do not reserve transfer spend; low reserve holds the whole plan', () => {
  for (const status of ['failed', 'expired']) assert.equal(planTopup({ ...input(), attempts: [{ day: '2026-10-16', total: DAY_CAP, outcome: { status } }] }).status, 'ready')
  assert.equal(planTopup({ ...input(), balances: { source: 255012499, crank: 0, operator: 0 } }).reason, 'reserve_low')
  assert.equal(planTopup({ ...input(), balances: { source: 255012500, crank: 0, operator: 0 } }).reserve_after, 5000000)
})
test('unreadable quantities, wrong days and excessive fees refuse', () => {
  for (const n of [-1, NaN, Infinity, 1.2, '0']) assert.throws(() => planTopup({ ...input(), balances: { ...input().balances, source: n } }))
  assert.throws(() => planTopup({ ...input(), fee: 20001 }))
  assert.throws(() => planTopup({ ...input(), day: 'today' }))
})
function fixture() {
  const ledger = { attempts: [] }, calls = []
  const a = { signature: 'sig', blockhash: 'hash', lastValidBlockHeight: 5, created_at: '2026-10-16T00:00:00Z', raw: 'AQ==', intent: 'intent', outcome: null }
  const api = {
    landAndAwait: async (_raw, opts) => { calls.push(['send', opts]); return { status: 'landed', signature: 'sig', slot: 123 } },
    resolveRecordedSend: async () => { calls.push(['resolve']); return { status: 'landed', signature: 'sig', slot: 123 } },
    TxNotLandedError: class extends Error { constructor(outcome) { super(outcome.status); this.outcome = outcome; this.signature = outcome.signature } },
  }
  return { ledger, calls, api, build: async () => { calls.push(['build']); return a }, save: () => { calls.push(['save', structuredClone(ledger)]) } }
}
test('worker saves signed intent before sending, passes preflight, saves confirmed result', async () => {
  const f = fixture(), a = await guardedAttempt(f)
  assert.deepEqual(f.calls.map(c => c[0]), ['build', 'save', 'send', 'save'])
  assert.equal(f.calls[1][1].attempts[0].outcome, null)
  assert.equal(f.calls[2][1].skipPreflight, false)
  assert.equal(f.calls[2][1].intent, 'intent')
  assert.equal(a.outcome.slot, 123)
})
test('failed journal write prevents broadcast', async () => {
  const f = fixture(); f.save = () => { throw new Error('disk full') }
  await assert.rejects(guardedAttempt(f), /disk full/)
  assert.equal(f.calls.some(c => c[0] === 'send'), false)
})
test('crash before/after broadcast reconciles without constructing or sending a new transaction', async () => {
  for (const status of [null, 'unknown']) {
    const f = fixture(), prior = await f.build(); f.calls.length = 0
    prior.outcome = status && { status, signature: 'sig' }; f.ledger.attempts.push(prior)
    await assert.rejects(guardedAttempt(f), /replan/)
    assert.deepEqual(f.calls.map(c => c[0]), ['resolve', 'save'])
    assert.equal(prior.outcome.status, 'landed')
  }
})
test('persistent unknown never unblocks the payer; chain errors cannot masquerade as success', async () => {
  const f = fixture(); f.api.landAndAwait = async () => ({ status: 'unknown', signature: 'sig' })
  await assert.rejects(guardedAttempt(f), /unknown/)
  f.calls.length = 0; f.api.resolveRecordedSend = async () => ({ status: 'unknown', signature: 'sig' })
  await assert.rejects(guardedAttempt(f), /replan/)
  assert.equal(f.calls.some(c => c[0] === 'send'), false)
  const g = fixture(); g.api.landAndAwait = async () => ({ status: 'failed', signature: 'sig', err: { InstructionError: [0, 1] } })
  await assert.rejects(guardedAttempt(g), /failed/)
})
test('a durable intent returning somebody else\'s signature refuses success', async () => {
  const f = fixture(); f.api.landAndAwait = async () => ({ status: 'landed', signature: 'other' })
  await assert.rejects(guardedAttempt(f), /unexpected signature/)
})
test('preflight and on-chain worker failures preserve actual Anchor log arrays for crank races', async () => {
  const mint = 'Gsb7AGhK4qE1otS6EW1ZQ6AGxSJaCeNXoEyKKQwLmQjo'
  const logs = [`Program ${mint} invoke [1]`, 'Program log: AnchorError caused by account: config. Error Code: NothingToSplit. Error Number: 6001. Error Message: Nothing to split.', `Program ${mint} failed: custom program error: 0x1771`]
  for (const preflight of [true, false]) {
    const f = fixture()
    f.api.landAndAwait = async () => ({ status: 'failed', signature: 'sig', err: preflight ? { preflight: 'Simulation failed. Message: Transaction simulation failed. Logs: '+JSON.stringify(logs), logs } : { InstructionError: [0, { Custom: 6001 }] } })
    if (!preflight) f.api.failureLogs = async () => logs
    let error; try { await guardedAttempt(f) } catch (e) { error = e }
    assert.deepEqual(error.logs, logs)
    const code = await mintFailureCode(error, {})
    assert.equal(code, 'NothingToSplit'); assert.equal(BENIGN.test(code), true)
  }
})
test('a prior resolved signature can never become a current revenue sweep or swap signature', async () => {
  for (const kind of ['busy','replan','unknown']) {
    const error = new WorkerDeferred(kind, 'old-split-signature')
    assert.equal(error.signature, undefined)
    const verdict = await classifySendFailure(error, async () => { throw new Error('Must not look up old signature as current send') })
    assert.equal(verdict.outcome, 'refused'); assert.equal(verdict.sig, null)
  }
})
test('two fee-payer lanes wait for the lease; a busy deadline defers without submitting', async () => {
  let attempts = 0, clock = 0, ran = 0
  const lock = async (_file, fn) => { if (++attempts < 3) throw Object.assign(new Error('held'), { code: 'ELOCKED' }); return fn() }
  assert.equal(await payerLease('lease', async () => { ran++; return 'sent' }, { lock, now: () => clock, delay: async ms => { clock += ms }, waitMs: 1000 }), 'sent')
  assert.equal(attempts, 3); assert.equal(ran, 1)
  await assert.rejects(payerLease('lease', async () => { throw new Error('Must never run') }, { lock: async () => { throw Object.assign(new Error('held'), { code: 'ELOCKED' }) }, now: () => clock, delay: async ms => { clock += ms }, waitMs: 500 }), e => e.noCurrentSend && e.kind === 'busy' && !e.signature)
})
test('alert keys deduplicate count fluctuations but preserve recovery and changed findings', () => {
  const key = text => alertKey(text,'cbob-crank','2026-10-16')
  assert.equal(key('Job failed 3 consecutive runs'),key('Job failed 99 consecutive runs'))
  assert.notEqual(key('Job failed 3 consecutive runs'),key('Job RECOVERED'))
  assert.notEqual(key('Job CRITICAL unexpected token transfer'),key('Job HIGH fee balance low'))
  assert.notEqual(alertKey('same','a','2026-10-16'),alertKey('same','a','2026-10-17'))
})
test('post-send journal failure retains the CURRENT signature for actual landed revenue recovery', async () => {
  const f = fixture(); let saves = 0
  f.save = () => { if (++saves === 2) throw new Error('disk full after landing') }
  let error;try { await guardedAttempt(f) } catch(e) { error=e }
  assert.equal(error.signature, 'sig')
  const outcome = await classifySendFailure(error, async signature => {
    assert.equal(signature,'sig');return { confirmationStatus:'finalized', err:null, slot:123 }
  })
  assert.equal(outcome.outcome,'landed');assert.equal(outcome.sig,'sig')
})
test('unexpected guard exception records unknown and exposes only the current attempt', async () => {
  const f = fixture();f.api.landAndAwait=async()=>{throw new Error('interrupted')}
  await assert.rejects(guardedAttempt(f),e=>e.signature==='sig'&&e.outcome.status==='unknown')
  assert.equal(f.ledger.attempts[0].outcome.status,'unknown')
})
