#!/usr/bin/env node
// Builtin-only gate executes before any bundled dependency code.
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {verifyCeremonyArtifact} from './ceremony-build.mjs'
if(process.execArgv.length)throw new Error('Signing launcher refuses Node execution overrides')
const allowedEnvironment = new Set(['PATH','LANG','LC_ALL','TZ','HOME','USER','LOGNAME','SHELL','PWD','INVOCATION_ID','JOURNAL_STREAM','SYSTEMD_EXEC_PID','MEMORY_PRESSURE_WATCH','MEMORY_PRESSURE_WRITE','RUNTIME_DIRECTORY','STATE_DIRECTORY','CACHE_DIRECTORY','LOGS_DIRECTORY','CONFIGURATION_DIRECTORY',
 'CBOB_CEREMONY_COMMIT','CBOB_CEREMONY_ARTIFACT_SHA256','CBOB_CEREMONY_PROFILE','CBOB_CEREMONY_ORIGINS','CBOB_CEREMONY_HOSTED_AUTH','CBOB_CEREMONY_PROXY_SECRET','CBOB_LOCAL_PORT','CBOB_RPC_UPSTREAM','CBOB_DAS_UPSTREAM','CBOB_RPC_ORIGIN','CBOB_RPC_PORT','CBOB_VAULT_COLLECTION'])
for (const name of Object.keys(process.env)) if (!allowedEnvironment.has(name)) delete process.env[name]
const tree=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
verifyCeremonyArtifact(tree,process.env.CBOB_CEREMONY_COMMIT,process.env.CBOB_CEREMONY_ARTIFACT_SHA256)
const server=path.join(tree,'web/deploy/ceremony-server.mjs')
process.argv[1]=server
await import(pathToFileURL(server).href)
