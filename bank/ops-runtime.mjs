import { createRequire } from 'node:module'

const require = createRequire('/opt/gary-club/package.json')
let loaded
let imports = Promise.resolve()
export async function garyModule(file) {
  if (!loaded) {
    require('@next/env').loadEnvConfig('/opt/gary-club')
    loaded = true
  }
  // Gary's tsconfig uses paths relative to its cwd. Serialize imports while
  // temporarily in that project, then restore the worker's original cwd.
  const result = imports.then(async () => {
    const cwd = process.cwd()
    try {
      process.chdir('/opt/gary-club')
      const { tsImport } = await import('/opt/cbob-vaults/bank/runtime/node_modules/tsx/dist/esm/api/index.mjs')
      return await tsImport('/opt/gary-club/' + file, {
        parentURL: import.meta.url, tsconfig: '/opt/gary-club/tsconfig.json',
      })
    } finally { process.chdir(cwd) }
  })
  imports = result.then(() => {}, () => {})
  return result
}

export const safeError = e => String(e?.message || e)
  .replace(/https?:\/\/[^\s"'<>]+/g, '[provider]')
  .replace(/(api[-_]?key|Bearer)\s*[:=]?\s*[^\s,}]+/gi, '[credential]')
  .slice(0, 500)
