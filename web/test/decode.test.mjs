/**
 * The page's Core and SPL readers against the official deserializers
 * (mpl-core deserializeAssetV1 / deserializeCollectionV1, spl-token
 * AccountLayout), on bytes laid out as Core and the Token program write them.
 * If our idea of the layout were wrong, the official reader would disagree or
 * refuse the same bytes.
 */
import * as web3 from '@solana/web3.js'
import * as spl from '@solana/spl-token'
import { publicKey as umiPk } from '@metaplex-foundation/umi'
import { deserializeAssetV1, deserializeCollectionV1 } from '@metaplex-foundation/mpl-core'
import { parseCoreAsset, parseCoreCollection, parseTokenAccount, parseProgramData } from '../src/lib/decode.mjs'
import { harness } from './ref.mjs'

const H = harness('decode')
const kp = n => web3.Keypair.fromSeed(Buffer.alloc(32, n)).publicKey
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
const s = v => Buffer.concat([u32(Buffer.byteLength(v)), Buffer.from(v)])
const raw = (pk, data) => ({ publicKey: umiPk(pk.toBase58()), executable: false, owner: umiPk('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'), lamports: { basisPoints: 1n, identifier: 'SOL', decimals: 9 }, data: new Uint8Array(data), exists: true })

/** An AssetV1 the way a CBOB vault is laid out: in a collection, sealed
 *  (PermanentFreezeExecute frozen, authority = an address), with a level attribute. */
function vaultBytes({ owner, coll, frozen = true, attrs = [['level', 'III'], ['charter', 'x']] }) {
  const base = Buffer.concat([Buffer.from([1]), owner.toBuffer(), Buffer.from([2]), coll.toBuffer(), s('CBOBTC Vault'), s('https://example.invalid/v.json'), Buffer.from([0])])
  const headerAt = base.length
  const p1At = headerAt + 9
  const p1 = Buffer.from([17, frozen ? 1 : 0])                                   // PermanentFreezeExecute { frozen }
  const p2At = p1At + p1.length
  const p2 = Buffer.concat([Buffer.from([6]), u32(attrs.length), ...attrs.flatMap(([k, v]) => [s(k), s(v)])]) // Attributes
  const p3At = p2At + p2.length
  const p3 = Buffer.from([7])                                                    // PermanentTransferDelegate {}
  const regAt = p3At + p3.length
  const sealPda = kp(90), rescue = kp(91)
  const reg = Buffer.concat([Buffer.from([4]), u32(3),
    Buffer.from([17, 3]), sealPda.toBuffer(), u64(p1At),
    Buffer.from([6, 2]), u64(p2At),
    Buffer.from([7, 3]), rescue.toBuffer(), u64(p3At),
    u32(0)])
  const header = Buffer.concat([Buffer.from([3]), u64(regAt)])
  return { bytes: Buffer.concat([base, header, p1, p2, p3, reg]), sealPda, rescue }
}

{
  const owner = kp(1), coll = kp(2), addr = kp(3)
  const { bytes, sealPda } = vaultBytes({ owner, coll })
  const mine = parseCoreAsset(bytes)
  const theirs = deserializeAssetV1(raw(addr, bytes))
  H.eq('asset: owner and collection agree with mpl-core', [mine.owner, mine.collection], [theirs.owner.toString(), theirs.updateAuthority.address.toString()])
  H.eq('asset: name and uri agree', [mine.name, mine.uri], [theirs.name, theirs.uri])
  H.eq('asset: sealed (PermanentFreezeExecute frozen) agrees', [mine.plugin('PermanentFreezeExecute').body.frozen, mine.plugin('PermanentFreezeExecute').authority.address],
    [theirs.permanentFreezeExecute.frozen, theirs.permanentFreezeExecute.authority.address.toString()])
  H.eq('asset: attributes agree', mine.plugin('Attributes').body.attributeList, theirs.attributes.attributeList)
  H.t('asset: the permanent transfer delegate is listed', !!mine.plugin('PermanentTransferDelegate') && !!theirs.permanentTransferDelegate)
  H.eq('asset: unsealed reads false on both', [parseCoreAsset(vaultBytes({ owner, coll, frozen: false }).bytes).plugin('PermanentFreezeExecute').body.frozen,
    deserializeAssetV1(raw(addr, vaultBytes({ owner, coll, frozen: false }).bytes)).permanentFreezeExecute.frozen], [false, false])
  H.eq('a burned Core asset (1 byte, key 0) reads as burned', parseCoreAsset(Buffer.from([0])), { burned: true })
  let threw = false; try { parseCoreAsset(bytes.subarray(0, 50)) } catch { threw = true }
  H.t('an asset truncated in its base fields THROWS (no guessed default)', threw)
  const cut = parseCoreAsset(bytes.subarray(0, bytes.length - 3))
  H.eq('an asset whose PLUGINS do not hold together still reads its owner and collection, and says its plugins are unknown',
    [cut.owner, cut.collection, cut.pluginsUnreadable, cut.plugins.length], [owner.toBase58(), coll.toBase58(), true, 0])
  // H1 case 4: a Core asset carrying a plugin type this reader does not parse (Groups, 18) or does not even know (77)
  for (const t of [18, 77]) {
    const base = Buffer.concat([Buffer.from([1]), owner.toBuffer(), Buffer.from([2]), coll.toBuffer(), s('x'), s('u'), Buffer.from([0])])
    const pAt = base.length + 9, body = Buffer.from([t, 0, 0, 0, 0])
    const regAt = pAt + body.length
    const g = Buffer.concat([base, Buffer.from([3]), u64(regAt), body, Buffer.from([4]), u32(1), Buffer.from([t, 2]), u64(pAt), u32(0)])
    const r = parseCoreAsset(g)
    H.eq(`an asset carrying plugin type ${t} is READ, not refused (owner, collection, the plugin listed by number)`,
      [r.owner, r.collection, r.pluginsUnreadable, r.plugins[0].typeId, r.plugins[0].body], [owner.toBase58(), coll.toBase58(), false, t, null])
  }
  threw = false; try { parseCoreAsset(Buffer.concat([Buffer.from([5]), bytes.subarray(1)])) } catch { threw = true }
  H.t('a collection passed as an asset THROWS', threw)
  void sealPda
}
{
  const ua = kp(5), addr = kp(6)
  const clean = Buffer.concat([Buffer.from([5]), ua.toBuffer(), s('CBOBTC Vaults'), s('https://example.invalid/c.json'), u32(0), u32(0)])
  const c = parseCoreCollection(clean), t = deserializeCollectionV1(raw(addr, clean))
  H.eq('collection (clean): update authority, counts, no plugins, agree with mpl-core',
    [c.updateAuthority, c.numMinted, c.currentSize, c.hasPluginHeader, c.plugins.length], [t.updateAuthority.toString(), t.numMinted, t.currentSize, false, 0])
  const revenue = kp(7)
  const base = clean
  const pAt = base.length + 9
  const roy = Buffer.concat([Buffer.from([0]), Buffer.from([0xe8, 0x03]), u32(1), revenue.toBuffer(), Buffer.from([100]), Buffer.from([0])])
  const regAt = pAt + roy.length
  const withRoy = Buffer.concat([base, Buffer.from([3]), u64(regAt), roy, Buffer.from([4]), u32(1), Buffer.from([0, 0]), u64(pAt), u32(0)])
  const c2 = parseCoreCollection(withRoy), t2 = deserializeCollectionV1(raw(addr, withRoy))
  const r = c2.plugin('Royalties')
  H.eq('collection (after MINT initialize): the royalty agrees with mpl-core',
    [r.body.basisPoints, r.body.creators.map(x => [x.address, x.percentage]), r.authority.type, r.body.ruleSet],
    [t2.royalties.basisPoints, t2.royalties.creators.map(x => [x.address.toString(), x.percentage]), t2.royalties.authority.type, t2.royalties.ruleSet.__kind === 'None' ? 0 : -1])
}
{
  const mint = kp(10), owner = kp(11), stranger = kp(12)
  const b = Buffer.alloc(165)
  spl.AccountLayout.encode({ mint, owner, amount: 777n, delegateOption: 0, delegate: web3.PublicKey.default, state: 2, isNativeOption: 0,
    isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 1, closeAuthority: stranger }, b)
  const t = parseTokenAccount(b)
  H.eq('token account: mint, owner, amount, frozen, close authority agree with spl-token AccountLayout',
    [t.mint, t.owner, t.amount, t.state, t.closeAuthority, t.delegate], [mint.toBase58(), owner.toBase58(), 777n, 2, stranger.toBase58(), null])
}
{
  const elf = Buffer.from('7f454c46', 'hex'), auth = kp(20)
  const pd = Buffer.concat([u32(3), u64(99), Buffer.from([1]), auth.toBuffer(), elf])
  const none = Buffer.concat([u32(3), u64(99), Buffer.from([0]), Buffer.alloc(32), elf])
  H.eq('ProgramData: the ELF starts at byte 45 with or without an authority',
    [parseProgramData(pd).upgradeAuthority, parseProgramData(pd).elf.toString('hex'), parseProgramData(none).upgradeAuthority, parseProgramData(none).elf.toString('hex')],
    [auth.toBase58(), '7f454c46', null, '7f454c46'])
}
export default H.done()
