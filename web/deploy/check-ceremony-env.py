#!/usr/bin/python3 -I
"""Check metadata only. Never print any environment-file content."""
import pathlib,re,sys
if len(sys.argv)!=2 or not re.fullmatch(r'[a-f0-9]{40}',sys.argv[1]):raise SystemExit('Invalid artifact identity')
for name in ['rpc-proxy.env','ceremony.env','ceremony-'+sys.argv[1]+'.env']:
 p=pathlib.Path('/etc/cbob')/name
 if p.resolve()!=p or p.stat().st_uid!=0 or p.stat().st_mode&0o022:raise SystemExit('Signing environment must be root-owned and not writable by others')
