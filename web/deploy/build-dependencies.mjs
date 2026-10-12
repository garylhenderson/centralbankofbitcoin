import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire,isBuiltin} from 'node:module'

const require=createRequire(import.meta.url)
export const dependencyRoots={app:'/opt/gary-club',tools:'/home/ubuntu/luna-remotion'}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const inside=(root,file)=>file.startsWith(root+path.sep)
const safeRel=rel=>typeof rel==='string'&&rel.length>0&&!path.isAbsolute(rel)&&!rel.split('/').some(p=>['','..','.'].includes(p))

// Snapshot manifest is independently pinned by its digest, never trusted simply
// because it sits beside the dependencies. Verify before loading build tools.
export function verifyDependencySnapshot(root,expected) {
  if(!/^[a-f0-9]{64}$/.test(expected||''))throw Error('Supply the reviewed dependency manifest digest')
  root=fs.realpathSync(root)
  const bytes=fs.readFileSync(path.join(root,'DEPENDENCIES.json'))
  if(hash(bytes)!==expected)throw Error('Dependency manifest digest differs')
  const manifest=JSON.parse(bytes)
  if(manifest.schema!==1||manifest.node!==process.version)throw Error('Dependency snapshot toolchain differs')
  const actual=[]
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const f=path.join(dir,entry.name),rel=path.relative(root,f)
    if(entry.isSymbolicLink())throw Error('Dependency snapshot contains a symlink')
    if(entry.isDirectory())walk(f)
    else if(entry.isFile()&&rel!=='DEPENDENCIES.json')actual.push(rel)
    else if(!entry.isFile())throw Error('Dependency snapshot contains a special file')
  }}
  walk(root)
  if(JSON.stringify(actual.sort())!==JSON.stringify(Object.keys(manifest.files||{}).sort()))throw Error('Dependency snapshot file set differs')
  for(const [rel,digest] of Object.entries(manifest.files)){
    if(!safeRel(rel)||!/^app\/node_modules\/|^tools\/node_modules\//.test(rel)||!/^[a-f0-9]{64}$/.test(digest))throw Error('Invalid dependency manifest file')
    if(hash(fs.readFileSync(path.join(root,rel)))!==digest)throw Error('Dependency snapshot bytes differ: '+rel)
  }
  return {root,manifest,digest:expected}
}

export function buildToolchain(source) {
  if(process.env.ESBUILD_BINARY_PATH)throw Error('Build binary overrides are refused')
  const specified=process.env.CBOB_BUILD_DEPS
  if(!specified&&process.env.CBOB_BUILD_DEPS_SHA256)throw Error('Missing dependency snapshot directory')
  const frozen=specified?verifyDependencySnapshot(specified,process.env.CBOB_BUILD_DEPS_SHA256):null
  const toolsRoot=frozen?path.join(frozen.root,'tools'):dependencyRoots.tools
  const esbuild=require(path.join(toolsRoot,'node_modules/esbuild'))
  if(!frozen)return {esbuild,plugins:[],frozen:null}
  // All source package imports start in the snapshot. Dependencies then resolve
  // from their own frozen package directories, including nested versions.
  const plugin={name:'frozen-build-dependencies',setup(build){
    build.onResolve({filter:/.*/},async args=>{
      if(args.pluginData?.cbobFrozen||args.namespace&&args.namespace!=='file'||(build.initialOptions.platform==='node'&&isBuiltin(args.path))||args.kind==='entry-point')return
      // Let esbuild apply each frozen package's own browser/exports mappings.
      if(inside(frozen.root,args.resolveDir))return
      const bare=!args.path.startsWith('.')&&!path.isAbsolute(args.path)
      let request=args.path,resolveDir=args.resolveDir
      for(const [kind,original] of Object.entries(dependencyRoots)){
        if(inside(original,request))request=path.join(frozen.root,kind,path.relative(original,request))
        if(inside(original,resolveDir))resolveDir=path.join(frozen.root,kind,path.relative(original,resolveDir))
      }
      if(bare&&(resolveDir===source||inside(source,resolveDir)))resolveDir=path.join(frozen.root,'app')
      const result=await build.resolve(request,{resolveDir,namespace:args.namespace,importer:args.importer,kind:args.kind,pluginData:{cbobFrozen:true}})
      if(result.path&&(!result.namespace||result.namespace==='file')&&!result.external&&!inside(source,result.path)&&!inside(frozen.root,result.path))throw Error('Build dependency escaped snapshot')
      return result
    })
    build.onEnd(result=>{
      for(const name of Object.keys(result.metafile?.inputs||{})){
        if(name.startsWith('disabled-optional:')||name.startsWith('<'))continue
        const file=path.resolve(source,name.replace(/^\([^)]*\):/,''))
        if(!inside(source,file)&&!inside(frozen.root,file))throw Error('Build dependency escaped snapshot')
      }
    })
  }}
  return {esbuild,plugins:[plugin],frozen}
}

export function dependencyRecord(source,metafiles,toolchain) {
  if(toolchain.frozen)verifyDependencySnapshot(toolchain.frozen.root,toolchain.frozen.digest)
  const roots=toolchain.frozen?Object.fromEntries(Object.keys(dependencyRoots).map(k=>[k,path.join(toolchain.frozen.root,k)])):dependencyRoots
  const files=new Set()
  for(const meta of metafiles)for(const name of Object.keys(meta.inputs)){
    if(name.startsWith('disabled-optional:')||name.startsWith('<'))continue
    files.add(path.resolve(source,name.replace(/^\([^)]*\):/,'')))
  }
  // esbuild's JS wrapper and platform executable run before metafiles exist.
  files.add(path.join(roots.tools,'node_modules/esbuild/lib/main.js'))
  files.add(path.join(roots.tools,`node_modules/@esbuild/${process.platform}-${process.arch}/bin/esbuild`))
  const inputs={},packages={}
  for(const file of [...files].sort()){
    if(inside(source,file)){inputs['source/'+path.relative(source,file)]=hash(fs.readFileSync(file));continue}
    const found=Object.entries(roots).find(([,root])=>inside(path.join(root,'node_modules'),file))
    if(!found)throw Error('Unrecorded build input: '+file)
    const [kind,root]=found
    const rel=path.relative(root,file),id=kind+'/'+rel
    inputs[id]=hash(fs.readFileSync(file))
    let dir=path.dirname(file),pkg
    while(inside(path.join(root,'node_modules'),dir)){
      const f=path.join(dir,'package.json')
      if(fs.existsSync(f)){const p=JSON.parse(fs.readFileSync(f));if(p.name&&p.version){pkg=p;break}}
      dir=path.dirname(dir)
    }
    if(!pkg)throw Error('Build input has no package identity: '+id)
    const packageRel=path.relative(root,dir),packageId=kind+'/'+packageRel
    if(!packages[packageId]){
      const lock=toolchain.frozen?null:JSON.parse(fs.readFileSync(path.join(root,'node_modules/.package-lock.json')))
      const entry=toolchain.frozen?.manifest.packages[packageId]||lock.packages[packageRel]
      if(!entry||entry.version!==pkg.version||!entry.integrity||!entry.resolved)throw Error('Package lacks locked registry provenance: '+packageId)
      packages[packageId]={name:pkg.name,version:pkg.version,resolved:entry.resolved,integrity:entry.integrity}
      inputs[packageId+'/package.json']=hash(fs.readFileSync(path.join(dir,'package.json')))
    }
  }
  return {schema:1,node:process.version,esbuild:toolchain.esbuild.version,snapshot:toolchain.frozen?.digest||null,packages:Object.fromEntries(Object.entries(packages).sort()),inputs:Object.fromEntries(Object.entries(inputs).sort())}
}

// Canonicalize only esbuild's comments and wrapper labels. Never rewrite
// executable expressions or string contents to hide a changed dependency.
export function normalizeBuildLabels(text,source,metafile,toolchain) {
  const labels=new Map(Object.keys(metafile.inputs).flatMap(f=>{
    if(f.startsWith('<')||f.startsWith('disabled-optional:'))return []
    const tagged=/^(\([^)]*\):)(.*)$/.exec(f),prefix=tagged?.[1]||'',name=tagged?.[2]||f,absolute=path.resolve(source,name)
    let canonical=absolute
    if(toolchain.frozen)for(const [kind,original] of Object.entries(dependencyRoots)){
      const root=path.join(toolchain.frozen.root,kind)
      if(inside(root,absolute))canonical=path.join(original,path.relative(root,absolute))
    }
    return inside(source,absolute)?[]:[[f,prefix+path.relative('/opt/cbob-vaults',canonical)]]
  }))
  return text.split('\n').map(line=>{
    const comment=/^(\s*\/\/ )(.+)$/.exec(line)
    if(comment&&labels.has(comment[2]))return comment[1]+labels.get(comment[2])
    const wrapper=/^(\s*)("[^"\n]+")([(].*)$/.exec(line)
    if(wrapper){const name=JSON.parse(wrapper[2]);if(labels.has(name))return wrapper[1]+JSON.stringify(labels.get(name))+wrapper[3]}
    return line
  }).join('\n')
}

export function reviewedDependencySnapshot(source) {
  const pin=JSON.parse(fs.readFileSync(path.join(source,'launch/build-dependency-lock.json')))
  if(!process.env.CBOB_BUILD_DEPS)throw Error('A frozen build dependency directory is required')
  if(process.env.CBOB_BUILD_DEPS_SHA256!==pin.snapshot_sha256)throw Error('Dependency snapshot is not the committed pin')
  return verifyDependencySnapshot(process.env.CBOB_BUILD_DEPS,pin.snapshot_sha256)
}
