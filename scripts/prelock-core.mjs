#!/usr/bin/env node
// Fresh live-Core evidence; provider credentials never leave this process.
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import {independentPrograms} from '../bank/live-programs.mjs'
try {
  const observed=await independentPrograms(), core=observed.identities.core, hash=core.sha256
  const pin = fs.readFileSync(new URL('./run-tests.sh', import.meta.url), 'utf8').match(/^CORE_SHA256_EXPECTED=([a-f0-9]{64})$/m)?.[1]
  const evidence = {checked_at:Math.floor(Date.now()/1000),...core,genesis:observed.genesis,pinned_sha256:pin,matches:hash===pin,bank_programs:Object.fromEntries(Object.entries(observed.identities).filter(([k])=>k!=='core')),observed_slots:[observed.observed_slot,observed.second_observed_slot],providers:observed.providers}
  console.log(JSON.stringify(evidence, null, 2))
  if (!evidence.matches) process.exitCode = 1
} catch {
  console.error('Live Core could not be verified. No lock; inspect RPC and retry.'); process.exitCode = 1
}
