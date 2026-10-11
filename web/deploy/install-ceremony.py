#!/usr/bin/python3 -I
"""Install only bytes named by the committed, reviewed full artifact attestation."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,tempfile
if os.geteuid()!=0 or len(sys.argv)!=5: raise SystemExit('Run the reviewed installer with source, review commit and independent artifact digest.')
candidate,review,commit,expected=pathlib.Path(sys.argv[1]),sys.argv[2],sys.argv[3],sys.argv[4]
if not all(re.fullmatch(r'[a-f0-9]{40}',x) for x in [commit,review]): raise SystemExit('Invalid source commit')
if candidate!=pathlib.Path('/opt/cbob-vaults/.cache/ceremony-artifacts')/commit: raise SystemExit('Invalid candidate path')
candidate=candidate.resolve()
if candidate!=pathlib.Path('/scratch/cbob-vaults-cache/ceremony-artifacts')/commit:raise SystemExit('Candidate cache target differs from the pinned server layout')
if not re.fullmatch(r'[a-f0-9]{64}',expected):raise SystemExit('Independent artifact digest required')
record_bytes=subprocess.check_output(['/usr/bin/git','-c','safe.directory=/opt/cbob-vaults','-c','core.fsmonitor=','-c','core.hooksPath=/dev/null','-C','/opt/cbob-vaults','show',review+':launch/ceremony-artifact.json'],env={'PATH':'/usr/bin:/bin','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'});record=json.loads(record_bytes)
if hashlib.sha256(record_bytes).hexdigest()!=expected:raise SystemExit('Committed attestation differs from independent digest')
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
