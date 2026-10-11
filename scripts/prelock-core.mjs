#!/usr/bin/env node
// Fresh live-Core evidence; provider credentials never leave this process.
import fs from 'node:fs'
import {independentPrograms} from '../bank/live-programs.mjs'
try {
  const observed=await independentPrograms(), core=observed.identities.core, hash=core.sha256
  // SPEC step 9, verified deployment on 10 October; this is only the pre-lock
  // check. After the first authority removal use the separate per-step readback.
  for(const [name,state] of Object.entries(observed.identities))if(name!=='core'&&state.upgrade_authority!=='FZjLB4e9mVMZTWA6YR1KbXVbByTqWsHpHy5sK83yJYUY')throw Object.assign(new Error('Unexpected Bank upgrade authority'),{code:'BANK_AUTHORITY_MISMATCH'})
  const pin = fs.readFileSync(new URL('./run-tests.sh', import.meta.url), 'utf8').match(/^CORE_SHA256_EXPECTED=([a-f0-9]{64})$/m)?.[1]
  const evidence = {checked_at:Math.floor(Date.now()/1000),...core,genesis:observed.genesis,pinned_sha256:pin,matches:hash===pin,bank_programs:Object.fromEntries(Object.entries(observed.identities).filter(([k])=>k!=='core')),observed_slots:[observed.observed_slot,observed.second_observed_slot],providers:observed.providers}
  console.log(JSON.stringify(evidence, null, 2))
  if (!evidence.matches) {console.error('Live Core differs from the reviewed pin. No lock; preserve evidence and escalate for review.');process.exitCode = 2}
} catch (e) {
  console.error(e.code==='BANK_AUTHORITY_MISMATCH'?'Bank upgrade authority differs from the expected deployment authority. No lock; escalate for review.':'Live program state could not be verified. No lock; inspect the independent read.'); process.exitCode = e.code==='BANK_AUTHORITY_MISMATCH'?2:1
}
