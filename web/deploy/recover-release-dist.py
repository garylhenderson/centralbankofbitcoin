#!/usr/bin/python3 -I
"""Recover existing release bytes from a CI archive, verifying source-pinned hashes.
Never compiles a program, reads a key, signs, or contacts a chain.
"""
import hashlib,json,pathlib,re,sys,zipfile

def recover(pins,archive,output):
 output=pathlib.Path(output)
 if output.exists():raise ValueError('Release output already exists')
 if not re.fullmatch(r'[a-f0-9]{40}',pins.get('commit','')) or set(pins.get('programs',{}))!={'seal','mint','burn','gov','sweep'}:raise ValueError('Invalid release pins')
 blobs={}
 with zipfile.ZipFile(archive) as zipped:
  for item in pins['programs'].values():
   name=item['file'];size=item['len'];digest=item['sha256']
   if not re.fullmatch(r'cbob_[a-z_]+\.so',name) or not isinstance(size,int) or not 0<size<10000000 or not re.fullmatch(r'[a-f0-9]{64}',digest):raise ValueError('Invalid program pin')
   member='workspace-mainnet/'+name
   if zipped.namelist().count(member)!=1 or zipped.getinfo(member).file_size!=size:raise ValueError('Missing, duplicate or wrong-size release program')
   data=zipped.read(member)
   if hashlib.sha256(data).hexdigest()!=digest:raise ValueError('Release program differs from audited hash')
   blobs[name]=data
 output.mkdir(parents=True)
 for name,data in blobs.items():(output/name).write_bytes(data)
 (output/'SHA256SUMS').write_text(''.join(hashlib.sha256(data).hexdigest()+'  '+name+'\n' for name,data in sorted(blobs.items())),encoding='utf-8')
 (output/'MANIFEST.txt').write_text('commit '+pins['commit']+'\ndirty no\nsource retrieved release bytes, verified against committed pins; no compilation\n',encoding='utf-8')
 return {'release_commit':pins['commit'],'program_hashes':{name:hashlib.sha256(data).hexdigest() for name,data in sorted(blobs.items())},'compiled':False}

if __name__=='__main__':
 if len(sys.argv)!=4:raise SystemExit('Pass source-derived pins JSON, existing CI archive and NEW dist directory')
 print(json.dumps(recover(json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')),sys.argv[2],sys.argv[3]),sort_keys=True))
