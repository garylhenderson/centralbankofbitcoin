#!/usr/bin/env node
// Existing hourly Notice job. Same route/schedule; no credential in curl argv.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
export function noticeSecret(raw) {
  const values=[...raw.matchAll(/^CRON_SECRET=(.*)$/gm)]
  if(values.length!==1)throw Error('Notice authentication unavailable')
  const secret=values[0][1].trim().replace(/^["']|["']$/g,'')
  if(!secret || /[\r\n]/.test(secret))throw Error('Notice authentication unavailable')
  return secret
}
export async function reconcileNotices(secret,fetchImpl=fetch) {
  const response=await fetchImpl('http://localhost:3003/api/cron/cbob-reconcile',{
    method:'POST',headers:{Authorization:`Bearer ${secret}`},redirect:'error',signal:AbortSignal.timeout(300000),
  })
  if(!response.ok)throw Error('Notice reconciliation refused')
  // Never log a response body: it can contain member information.
  await response.arrayBuffer()
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    await reconcileNotices(noticeSecret(fs.readFileSync('/opt/gary-club/.env.local','utf8')))
    console.log('CBOB Notice reconciliation completed')
  } catch {console.error('CBOB Notice reconciliation failed; inspect application diagnostics');process.exitCode=1}
}
