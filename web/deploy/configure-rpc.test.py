"""Real filesystem metadata and atomic-write checks; only temporary fixtures."""
import importlib.util
import os
from pathlib import Path
import pwd
import tempfile
import json
import sys
sys.dont_write_bytecode=True
import unittest

spec=importlib.util.spec_from_file_location('configure_rpc',Path(__file__).with_name('configure-rpc.py'))
rpc=importlib.util.module_from_spec(spec)
spec.loader.exec_module(rpc)


class RelayEnvironmentTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='cbob-rpc-metadata-')
  self.root=Path(self.temp.name)
  self.env=self.root/'rpc.env'
  self.original='# fixture only\nCBOB_RPC_UPSTREAM=https://example.invalid/fixture\n'
  self.env.write_text(self.original)
  self.ubuntu=pwd.getpwnam('ubuntu')
  self.previous=(rpc.BACKUPS,rpc.ENV)
  rpc.BACKUPS=self.root/'backups';rpc.BACKUPS.mkdir(mode=0o700)
  rpc.ENV=self.env
 def tearDown(self):
  rpc.BACKUPS,rpc.ENV=self.previous
  self.temp.cleanup()
 def layout(self,uid,gid,mode):os.chown(self.env,uid,gid);self.env.chmod(mode)
 def test_root_group_read_survives_collection_write_and_restore(self):
  self.layout(0,self.ubuntu.pw_gid,0o640)
  self.assertEqual(rpc.read_relay_environment(self.env)[0],self.original)
  updated=self.original+'CBOB_VAULT_COLLECTION=11111111111111111111111111111111\n'
  rpc.atomic(self.env,updated)
  self.assertEqual(rpc.read_relay_environment(self.env)[0],updated)
  backup=rpc.BACKUPS/'fixture';backup.mkdir(mode=0o700)
  (backup/self.env.name).write_text(self.original)
  (backup/'manifest.json').write_text(json.dumps([{'path':str(self.env),'existed':True,'uid':0,'gid':self.ubuntu.pw_gid,'mode':0o640}]))
  self.env.unlink()
  rpc.restore(backup)
  self.assertEqual(rpc.read_relay_environment(self.env)[0],self.original)
  st=self.env.stat();self.assertEqual((st.st_uid,st.st_gid,st.st_mode&0o777),(0,self.ubuntu.pw_gid,0o640))
 def test_legacy_private_layout_is_preserved(self):
  self.layout(self.ubuntu.pw_uid,self.ubuntu.pw_gid,0o600)
  self.assertEqual(rpc.read_relay_environment(self.env)[0],self.original)
  rpc.atomic(self.env,self.original+'# retained\n')
  st=self.env.stat();self.assertEqual((st.st_uid,st.st_gid,st.st_mode&0o777),(self.ubuntu.pw_uid,self.ubuntu.pw_gid,0o600))
 def test_unsafe_permissions_or_owner_are_refused(self):
  for uid,gid,mode in [(0,self.ubuntu.pw_gid,0o660),(0,self.ubuntu.pw_gid,0o644),(0,0,0o640),(self.ubuntu.pw_uid,self.ubuntu.pw_gid,0o640),(65534,self.ubuntu.pw_gid,0o600)]:
   with self.subTest(layout=(uid,gid,mode)):
    self.layout(uid,gid,mode)
    with self.assertRaises(ValueError):rpc.read_relay_environment(self.env)
 def test_symlink_is_refused(self):
  self.layout(0,self.ubuntu.pw_gid,0o640)
  link=self.root/'link';link.symlink_to(self.env)
  with self.assertRaises(OSError):rpc.read_relay_environment(link)
 def test_fifo_is_refused_without_blocking(self):
  fifo=self.root/'fifo';os.mkfifo(fifo,0o640);os.chown(fifo,0,self.ubuntu.pw_gid)
  with self.assertRaises(ValueError):rpc.read_relay_environment(fifo)

 def test_parent_symlink_or_writable_directory_is_refused(self):
  self.layout(0,self.ubuntu.pw_gid,0o640)
  link=self.root/'parent-link';link.symlink_to(self.root,target_is_directory=True)
  with self.assertRaises(ValueError):rpc.read_relay_environment(link/self.env.name)
  self.root.chmod(0o770)
  with self.assertRaises(ValueError):rpc.read_relay_environment(self.env)
  self.root.chmod(0o700)
 def test_atomic_refuses_symlinks_and_hardlinks(self):
  link=self.root/'link';link.symlink_to(self.env)
  with self.assertRaises(ValueError):rpc.atomic(link,'refused')
  link.unlink();os.link(self.env,link)
  with self.assertRaises(ValueError):rpc.atomic(self.env,'refused')
  with self.assertRaises(ValueError):rpc.read_relay_environment(self.env)
  self.assertEqual(self.env.read_text(),self.original)
 def test_bad_encoding_does_not_disclose_content(self):
  self.layout(0,self.ubuntu.pw_gid,0o640);self.env.write_bytes(b'fixture=\xff')
  with self.assertRaisesRegex(ValueError,'^Relay environment is not valid UTF-8$'):rpc.read_relay_environment(self.env)
 def test_restore_keeps_original_bytes(self):
  backup=rpc.BACKUPS/'fixture';backup.mkdir(mode=0o700)
  original=b'# fixture\r\nUPSTREAM=example\r\n# opaque backup byte: \xff\r\n'
  (backup/self.env.name).write_bytes(original)
  (backup/'manifest.json').write_text(json.dumps([{'path':str(self.env),'existed':True,'uid':0,'gid':self.ubuntu.pw_gid,'mode':0o640}]))
  rpc.restore(backup)
  self.assertEqual(self.env.read_bytes(),original)
 def test_restore_overrides_current_owner_and_rejects_invalid_recorded_layout(self):
  backup=rpc.BACKUPS/'fixture';backup.mkdir(mode=0o700)
  (backup/self.env.name).write_text(self.original)
  row={'path':str(self.env),'existed':True,'uid':0,'gid':self.ubuntu.pw_gid,'mode':0o640}
  (backup/'manifest.json').write_text(json.dumps([row]))
  self.layout(65534,65534,0o600);rpc.restore(backup)
  self.assertEqual(rpc.read_relay_environment(self.env)[1],(0,self.ubuntu.pw_gid,0o640))
  row['mode']=0o644;(backup/'manifest.json').write_text(json.dumps([row]))
  with self.assertRaises(ValueError):rpc.restore(backup)


if __name__=='__main__':
 if os.geteuid()!=0:raise SystemExit('Run with sudo /usr/bin/python3 -I; root metadata tests must not be skipped')
 unittest.main()
