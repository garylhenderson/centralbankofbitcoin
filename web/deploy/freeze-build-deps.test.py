import importlib.util, io, json, pathlib, tarfile, tempfile, unittest, hashlib, base64
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
   m.fetch_tarball({'resolved':'https://registry.npmjs.org/pkg.tgz','integrity':'sha512-'+base64.b64encode(b'0'*64).decode()})
 def test_reconstruct(self):
  pkg=b'{"name":"example","version":"1.0.0"}'
  data=archive([('package/package.json',pkg,tarfile.REGTYPE),('package/index.js',b'original',tarfile.REGTYPE)])
  record={'schema':1,'node':'test','esbuild':'test','packages':{'app/node_modules/example':{'name':'example','version':'1.0.0','integrity':'sha512-test','resolved':'https://registry.npmjs.org/example.tgz'}},'inputs':{'app/node_modules/example/index.js':hashlib.sha256(b'original').hexdigest()}}
  with tempfile.TemporaryDirectory() as root,patch.object(m,'fetch_tarball',return_value=data):
   a=m.freeze([record],pathlib.Path(root)/'one');b=m.freeze([record],pathlib.Path(root)/'two');self.assertEqual(a,b)
   with self.assertRaises(ValueError):m.freeze([record],pathlib.Path(root)/'one')
   record['inputs']['app/node_modules/example/index.js']='0'*64
   with self.assertRaises(ValueError):m.freeze([record],pathlib.Path(root)/'bad')
   self.assertFalse((pathlib.Path(root)/'bad').exists())
   # Restore directory permissions for TemporaryDirectory cleanup.
   for p in pathlib.Path(root).rglob('*'):
    if p.is_dir():p.chmod(0o755)
 def test_expected_digest(self):
  record={'schema':1,'node':'test','esbuild':'test','packages':{},'inputs':{},'snapshot_sha256':'0'*64}
  with tempfile.TemporaryDirectory() as root,self.assertRaises(ValueError):m.freeze([record],pathlib.Path(root)/'bad')
if __name__=='__main__':
 result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
 if not result.wasSuccessful():raise SystemExit(1)
 print('7 dependency reconstruction tests passed')
