#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {isBuiltin} from 'node:module'
import {buildToolchain,dependencyRecord,normalizeBuildLabels} from './build-dependencies.mjs'
const [source,output]=process.argv.slice(2)
if(!source||!output)throw new Error('Pass isolated source and artifact directories')
const toolchain=buildToolchain(source),esbuild=toolchain.esbuild
const built=await esbuild.build({
 entryPoints:[path.join(source,'web/deploy/ceremony-local.mjs')],outfile:path.join(output,'web/deploy/ceremony-server.mjs'),
 tsconfigRaw:{},bundle:true,platform:'node',format:'esm',logLevel:'warning',metafile:true,absWorkingDir:source,
 banner:{js:'import {createRequire,isBuiltin} from "node:module"; import {fileURLToPath as bundleFile} from "node:url"; import {dirname as bundleDir} from "node:path"; const builtinRequire=createRequire(import.meta.url); const require=id=>{if(!isBuiltin(id))throw new Error("Non-builtin runtime load refused");return builtinRequire(id)}; const __filename=bundleFile(import.meta.url); const __dirname=bundleDir(__filename);'},
 plugins:[...toolchain.plugins,{name:'relay-library-only',setup(build){
  // Optional native/text converters are unnecessary for JSON RPC. Keep the
  // libraries' existing JS fallback and forbid runtime resolution outside here.
  build.onResolve({filter:/^(encoding|bufferutil|utf-8-validate)$/},args=>({path:args.path,namespace:'disabled-optional'}))
  build.onLoad({filter:/.*/,namespace:'disabled-optional'},()=>({contents:'throw new Error("Optional native converter disabled in signing server");',loader:'js'}))
  build.onLoad({filter:/\/web\/deploy\/rpc-proxy\.mjs$/},args=>{
  const text=fs.readFileSync(args.path,'utf8'),guard='if (process.argv[1] === fileURLToPath(import.meta.url)) {'
  if(text.split(guard).length!==2)throw new Error('Relay entrypoint changed; review bundler before continuing')
  // In a single bundle every import.meta.url is the bundle URL. Do not run the
  // imported relay module's standalone listener as well as the ceremony server.
  return{contents:text.replace(guard,'if (false /* ceremony bundle: relay is a library */) {'),loader:'js'}
 })}}]
})
if(built.warnings.length)throw new Error('Signing bundle emitted warnings')
for(const output of Object.values(built.metafile.outputs))for(const item of output.imports)if(item.external&&!isBuiltin(item.path))throw new Error('Unbundled runtime import: '+item.path)
fs.writeFileSync(path.join(output,'web/deploy/build-inputs.json'),JSON.stringify(dependencyRecord(source,[built.metafile],toolchain),null,2)+'\n')
const bundle=path.join(output,'web/deploy/ceremony-server.mjs')
fs.writeFileSync(bundle,normalizeBuildLabels(fs.readFileSync(bundle,'utf8'),source,built.metafile,toolchain))
