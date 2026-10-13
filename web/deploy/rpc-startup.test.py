#!/usr/bin/env python3
"""Exercise the actual PM2 entry configuration in a private daemon, without RPC calls."""
import json, os, pathlib, shutil, socket, subprocess, tempfile, time, urllib.error, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[2]
PM2=shutil.which('pm2')
if not PM2: raise SystemExit('PM2 required; this integration check cannot be skipped')
with tempfile.TemporaryDirectory(prefix='cbob-rpc-startup-') as tmp:
 folder=pathlib.Path(tmp)
 env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','USER','LOGNAME','LANG']}
 env['PM2_HOME']=str(folder/'pm2')
 with socket.socket() as sock:
  sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 cfg=json.loads(subprocess.check_output(['/usr/bin/node','-e','console.log(JSON.stringify(require(process.argv[1])))',str(ROOT/'web/deploy/ecosystem.rpc-proxy.config.cjs')],env=env,text=True))
 app=cfg['apps'][0];app['name']='cbob-rpc-startup-test';app['autorestart']=False
 secrets=folder/'rpc.env'
 secrets.write_text(f'CBOB_RPC_UPSTREAM=https://example.invalid\nCBOB_RPC_ORIGIN=https://centralbankofbitcoin.com\nCBOB_RPC_PORT={port}\nCBOB_VAULT_COLLECTION=7gP5aFq3qZ2EdhHiZ9BZ79c3g92pGBvFFpxTdxZAHBKU\n')
 secrets.chmod(0o600)
 # Only relocate the configuration input; preserve the production launch shape.
 for key in ['args','node_args']:
  if key in app:
   value=app[key]
   app[key]=[x.replace('/etc/cbob/rpc-proxy.env',str(secrets)) for x in value] if isinstance(value,list) else value.replace('/etc/cbob/rpc-proxy.env',str(secrets))
 conf=folder/'ecosystem.config.cjs';conf.write_text('module.exports = '+json.dumps(cfg)+';\n')
 def pm2(*args):
  return subprocess.run([PM2,*args],env=env,capture_output=True,text=True,timeout=25)
 try:
  start=pm2('start',str(conf));assert start.returncode==0,'Isolated PM2 start failed'
  deadline=time.monotonic()+12
  while True:
   try:
    urllib.request.urlopen(f'http://127.0.0.1:{port}',timeout=1)
    raise AssertionError('Unexpected unauthenticated success')
   except urllib.error.HTTPError as error:
    assert error.code==405
    assert json.loads(error.read())['error']['message']=='POST only'
    break
   except urllib.error.URLError:
    if time.monotonic()>=deadline:raise AssertionError('Actual PM2 configuration never started the loopback listener')
    time.sleep(.2)
  request=urllib.request.Request(f'http://127.0.0.1:{port}',data=b'{}',headers={'Content-Type':'application/json'})
  try:urllib.request.urlopen(request,timeout=2);raise AssertionError('Missing origin accepted')
  except urllib.error.HTTPError as error:assert error.code==403
  print('PASS: actual PM2 launch serves loopback; GET and missing Origin refuse without upstream access')
 finally:
  stop=pm2('kill')
  if stop.returncode:raise RuntimeError('Private PM2 cleanup failed')
