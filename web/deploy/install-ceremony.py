#!/usr/bin/env python3
"""Install only bytes named by the committed, reviewed full artifact attestation."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,tempfile
if os.geteuid()!=0 or len(sys.argv)!=4: raise SystemExit('Run through prepare-ceremony.sh --install.')
candidate,review,commit=pathlib.Path(sys.argv[1]),sys.argv[2],sys.argv[3]
if not all(re.fullmatch(r'[a-f0-9]{40}',x) for x in [commit,review]): raise SystemExit('Invalid source commit')
if candidate!=pathlib.Path('/opt/cbob-vaults/.cache/ceremony-artifacts')/commit: raise SystemExit('Invalid candidate path')
record_bytes=subprocess.check_output(['git','-c','safe.directory=/opt/cbob-vaults','-C','/opt/cbob-vaults','show',review+':launch/ceremony-artifact.json']);record=json.loads(record_bytes)
if record.get('source_commit')!=commit: raise SystemExit('Attestation names another source commit')
parent=pathlib.Path('/opt/cbob-ceremony');parent.mkdir(mode=0o755,exist_ok=True)
if parent.is_symlink() or parent.stat().st_uid!=0 or parent.stat().st_mode&0o022:raise SystemExit('Unsafe artifact parent')
target=parent/commit
if target.exists():raise SystemExit('Artifact already exists; never overwrite it')
stage=pathlib.Path(tempfile.mkdtemp(prefix='.install-',dir=parent))
try:
 for rel,digest in record['files'].items():
  part=pathlib.PurePosixPath(rel)
  if part.is_absolute() or '..' in part.parts or not re.fullmatch(r'[a-f0-9]{64}',digest):raise ValueError('Unsafe attestation entry')
  source=candidate/rel
  if source.resolve()!=source:raise ValueError('Candidate symlink refused')
  data=source.read_bytes()
  if hashlib.sha256(data).hexdigest()!=digest:raise ValueError('Candidate differs from committed attestation')
  dest=stage/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data);dest.chmod(0o444)
 (stage/'ARTIFACT.json').write_bytes(record_bytes);(stage/'ARTIFACT.json').chmod(0o444)
 for directory,_,_ in os.walk(stage):pathlib.Path(directory).chmod(0o555)
 stage.rename(target)
 identity=pathlib.Path('/etc/cbob')/('ceremony-'+commit+'.env')
 if identity.exists():raise ValueError('Artifact identity file already exists')
 fd=os.open(identity,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'w')as f:f.write('CBOB_CEREMONY_ARTIFACT_SHA256='+hashlib.sha256(record_bytes).hexdigest()+'\n')
 print('Installed root-owned reviewed artifact '+commit+'. No service or DNS changed.')
finally:
 if stage.exists():shutil.rmtree(stage)
