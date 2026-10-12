import importlib.util, io, json, pathlib, tarfile, tempfile, unittest, hashlib, base64, zipfile
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('freeze',pathlib.Path(__file__).with_name('freeze-build-deps.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def archive(entries):
 out=io.BytesIO()
 with tarfile.open(fileobj=out,mode='w:gz') as tar:
  for name,body,kind in entries:
   member=tarfile.TarInfo(name);member.type=kind;member.size=len(body);member.linkname='/tmp/escape'
   tar.addfile(member,io.BytesIO(body))
 return out.getvalue()
class Tests(unittest.TestCase):
 def test_traversal(self):
  for name in ['package/../escape','/package/index.js','package/a/../../escape']:
   with tempfile.TemporaryDirectory() as root,self.assertRaises(ValueError):m.extract_package(archive([(name,b'x',tarfile.REGTYPE)]),pathlib.Path(root))
 def test_links(self):
  for kind in [tarfile.SYMTYPE,tarfile.LNKTYPE,tarfile.FIFOTYPE]:
   with tempfile.TemporaryDirectory() as root,self.assertRaises(ValueError):m.extract_package(archive([('package/a',b'',kind)]),pathlib.Path(root))
 def test_duplicate_and_bundled(self):
  for entries in [[('package/a',b'x',tarfile.REGTYPE)]*2,[('package/node_modules/x',b'x',tarfile.REGTYPE)]]:
   with tempfile.TemporaryDirectory() as root,self.assertRaises(ValueError):m.extract_package(archive(entries),pathlib.Path(root))
 def test_url(self):
  for url in ['http://registry.npmjs.org/pkg','https://evil.invalid/pkg','https://user@registry.npmjs.org/pkg','https://registry.npmjs.org/pkg?key=x']:
   with self.assertRaises(ValueError):m.fetch_tarball({'resolved':url,'integrity':'sha512-YQ=='})
 def test_integrity(self):
  class Response(io.BytesIO): pass
  class Opener:
   def open(self,*a,**kw):return Response(b'wrong')
  with patch.object(m.urllib.request,'build_opener',return_value=Opener()),self.assertRaises(ValueError):
   m.fetch_tarball({'name':'pkg','version':'1.0.0','resolved':'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz','integrity':'sha512-'+base64.b64encode(b'0'*64).decode()})
 def test_reconstruct(self):
  pkg=b'{"name":"example","version":"1.0.0"}'
  data=archive([('package/package.json',pkg,tarfile.REGTYPE),('package/index.js',b'original',tarfile.REGTYPE)])
  record={'schema':1,'node':'test','esbuild':'test','packages':{'app/node_modules/example':{'name':'example','version':'1.0.0','integrity':'sha512-test','resolved':'https://registry.npmjs.org/example/-/example-1.0.0.tgz'}},'inputs':{'app/node_modules/example/index.js':hashlib.sha256(b'original').hexdigest()}}
  with tempfile.TemporaryDirectory() as root,patch.object(m,'fetch_tarball',return_value=data):
   a=m.freeze([record],pathlib.Path(root)/'one');b=m.freeze([record],pathlib.Path(root)/'two');self.assertEqual(a,b)
   with self.assertRaises(ValueError):m.freeze([record],pathlib.Path(root)/'one')
   record['inputs']['app/node_modules/example/index.js']='0'*64
   with self.assertRaises(ValueError):m.freeze([record],pathlib.Path(root)/'bad')
   self.assertFalse((pathlib.Path(root)/'bad').exists())
   # Restore directory permissions for TemporaryDirectory cleanup.
   for p in pathlib.Path(root).rglob('*'):
    if p.is_dir():p.chmod(0o755)
 def test_name_confusion(self):
  with self.assertRaises(ValueError):m.registry_identity({'name':'ws','version':'8.19.0','resolved':'https://registry.npmjs.org/evil/-/evil-1.0.0.tgz'})
 def test_package_path(self):
  entry={'name':'ws','version':'8.19.0','resolved':'https://registry.npmjs.org/ws/-/ws-8.19.0.tgz'}
  for key in ['app/node_modules/ws/lib','app/node_modules/evil','app/node_modules/@bad/ws']:
   with self.assertRaises(ValueError):m.registry_identity(entry,key)
  m.registry_identity(entry,'app/node_modules/parent/node_modules/ws')
 def test_expected_digest(self):
  record={'schema':1,'node':'test','esbuild':'test','packages':{},'inputs':{},'snapshot_sha256':'0'*64}
  with tempfile.TemporaryDirectory() as root,self.assertRaises(ValueError):m.freeze([record],pathlib.Path(root)/'bad')
spec2=importlib.util.spec_from_file_location('installer',pathlib.Path(__file__).with_name('install-ceremony.py'))
installer=importlib.util.module_from_spec(spec2);spec2.loader.exec_module(installer)
class InstallerTests(unittest.TestCase):
 def data(self):
  lock={'schema':1,'snapshot_sha256':'a'*64,'node':'test','esbuild':'test','packages':{},'inputs':{'tools/node_modules/esbuild/lib/main.js':'1'*64}}
  record={'schema':1,'snapshot':lock['snapshot_sha256'],'node':'test','esbuild':'test','packages':{},'inputs':{**lock['inputs'],'source/a.mjs':'2'*64}}
  return json.dumps(lock).encode(),record
 def test_snapshot_required(self):
  lock,record=self.data();installer.validate_build_provenance(lock,lock,[record,record])
  for change in [{'snapshot':None},{'node':'wrong'},{'esbuild':'wrong'}]:
   with self.assertRaises(ValueError):installer.validate_build_provenance(lock,lock,[record,{**record,**change}])
  with self.assertRaises(ValueError):installer.validate_build_provenance(lock,b'{}',[record,record])
 def test_unknown_dependency(self):
  lock,record=self.data();record['inputs']['app/node_modules/evil/a.js']='3'*64
  with self.assertRaises(ValueError):installer.validate_build_provenance(lock,lock,[record,record])
spec3=importlib.util.spec_from_file_location('recover',pathlib.Path(__file__).with_name('recover-release-dist.py'))
recoverer=importlib.util.module_from_spec(spec3);spec3.loader.exec_module(recoverer)
class RecoveryTests(unittest.TestCase):
 def test_pinned_binaries_only(self):
  with tempfile.TemporaryDirectory() as root:
   root=pathlib.Path(root);archive=root/'release.zip'
   pins={'commit':'a'*40,'programs':{k:{'file':'cbob_'+k+'.so','len':3,'sha256':hashlib.sha256(b'elf').hexdigest()} for k in ['seal','mint','burn','gov','sweep']}}
   with zipfile.ZipFile(archive,'w') as z:
    for p in pins['programs'].values():z.writestr('workspace-mainnet/'+p['file'],b'elf')
    z.writestr('../../never-extract',b'outside')
   result=recoverer.recover(pins,archive,root/'dist');self.assertFalse(result['compiled']);self.assertEqual(len(result['program_hashes']),5)
   with self.assertRaises(ValueError):recoverer.recover(pins,archive,root/'dist')
   pins['programs']['mint']['sha256']='0'*64
   with self.assertRaises(ValueError):recoverer.recover(pins,archive,root/'bad')
   self.assertFalse((root/'bad').exists())
if __name__=='__main__':
 result=unittest.TextTestRunner().run(unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromTestCase(Tests),unittest.defaultTestLoader.loadTestsFromTestCase(InstallerTests),unittest.defaultTestLoader.loadTestsFromTestCase(RecoveryTests)]))
 if not result.wasSuccessful():raise SystemExit(1)
 print('12 dependency reconstruction/installer tests passed')
