#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),esbuild=require('/home/ubuntu/luna-remotion/node_modules/esbuild')
const [source,output]=process.argv.slice(2)
if(!source||!output)throw new Error('Pass isolated source and artifact directories')
await esbuild.build({
 entryPoints:[path.join(source,'web/deploy/ceremony-local.mjs')],outfile:path.join(output,'web/deploy/ceremony-server.mjs'),
 bundle:true,platform:'node',format:'esm',logLevel:'silent',
 banner:{js:'import {createRequire} from "node:module"; import {fileURLToPath as bundleFile} from "node:url"; import {dirname as bundleDir} from "node:path"; const require=createRequire(import.meta.url); const __filename=bundleFile(import.meta.url); const __dirname=bundleDir(__filename);'},
 plugins:[{name:'relay-library-only',setup(build){build.onLoad({filter:/\/web\/deploy\/rpc-proxy\.mjs$/},args=>{
  const text=fs.readFileSync(args.path,'utf8'),guard='if (process.argv[1] === fileURLToPath(import.meta.url)) {'
  if(text.split(guard).length!==2)throw new Error('Relay entrypoint changed; review bundler before continuing')
  // In a single bundle every import.meta.url is the bundle URL. Do not run the
  // imported relay module's standalone listener as well as the ceremony server.
  return{contents:text.replace(guard,'if (false /* ceremony bundle: relay is a library */) {'),loader:'js'}
 })}}]
})
