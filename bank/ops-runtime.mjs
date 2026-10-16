import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire('/opt/gary-club/package.json')
let loaded
export async function garyModule(file) {
  if (process.env.CBOB_OPS_RUNTIME !== 'tsx-4.23.15' || process.cwd() !== '/opt/gary-club') {
    throw new Error('Run production CBOB operations through /opt/cbob-vaults/bank/ops-node with absolute script paths')
  }
  if (!loaded) {
    require('@next/env').loadEnvConfig('/opt/gary-club')
    loaded = true
  }
  // The CLI's filesystem loader also handles the guard's later dynamic imports.
  // Scoped tsImport data URLs do not support those lazy registry imports.
  return import(pathToFileURL('/opt/gary-club/' + file).href)
}

export const safeError = e => String(e?.message || e)
  .replace(/https?:\/\/[^\s"'<>]+/g, '[provider]')
  .replace(/(api[-_]?key|Bearer)\s*[:=]?\s*[^\s,}]+/gi, '[credential]')
  .slice(0, 500)
