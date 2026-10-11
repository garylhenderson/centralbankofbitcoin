#!/usr/bin/env node
// Builtin-only gate executes before any bundled dependency code.
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {verifyCeremonyArtifact} from './ceremony-build.mjs'
const tree=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
verifyCeremonyArtifact(tree,process.env.CBOB_CEREMONY_COMMIT,process.env.CBOB_CEREMONY_ARTIFACT_SHA256)
const server=path.join(tree,'web/deploy/ceremony-server.mjs')
process.argv[1]=server
await import(pathToFileURL(server).href)
