import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
import {validateAcceptedPins} from './pin-review.mjs'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const commit=execFileSync('/usr/bin/git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()
validateAcceptedPins(root,commit)
console.log('Committed fingerprints match their exact independent review.')
