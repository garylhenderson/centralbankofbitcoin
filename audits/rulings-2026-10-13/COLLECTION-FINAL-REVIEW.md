**APPROVED.** I found no remaining blocker at `8707aeaef00e2dc84542ec0b22db775ccbe631c4`.

Reviewed source commit: `8707aeaef00e2dc84542ec0b22db775ccbe631c4`
Pin acceptance: APPROVED for `8707aeaef00e2dc84542ec0b22db775ccbe631c4`

I only read files. Every test, build, hash and git-status result below comes from the operator's report or from artifacts the operator produced. I ran nothing myself.

**Earlier blocker (dirty `web/`)**
- The patch now has a `web/src/generated/launch.json` hunk. It moves `vault_collection` from `null`/`OPEN` to `7gP5…BKU`/`RULED`, which is the hunk I said was missing.
- Both `collection-final-mainnet/BUILD.txt` and `collection-final-mainnet-local/BUILD.txt` show line 2 as the bare commit `8707aeae…` with no "uncommitted changes" suffix.
- Both builds list `collection 7gP5aFq3qZ2EdhHiZ9BZ79c3g92pGBvFFpxTdxZAHBKU`.
- `launch.json` and `config.js:77` in `/opt/cbob-vaults` hold that address, and it matches `ceremony-completed.json:498`.
- The Gary adapter at `/scratch/cbob-launch-week` has the same address at `club-engine.cjs:1045`. It is the only match for that address in the repo.
- Both `*-inputs.json` files carry snapshot `8b6263c3…` with identical contents. Their `launch.json` hash is the same in both: `27531aaa…`.

**Test edits (patch hunks)**
- `ceremony.test.mjs`: the real mainnet record must now pass the launch gate with no refusals. An explicit `OPEN` fixture still has to be refused by `judgeLaunch` and `judgeRehearsal`.
- `governance.test.mjs`: the preinitialization case now passes `collection: null` explicitly.
- `ids.test.mjs`: the mainnet profile collection must equal both `launch.json` and the ceremony receipt's `collection`.
- `meta.test.mjs`: the regex follows the new copy.
- No assertion is weakened and no floor is lowered. The one loosening is that the old "only `vault_collection` is OPEN" check became "no refusals", which fits the ruled collection.

**Metadata copy (`web/meta/generate.mjs`)**

I checked it against `HOLDER-GUIDE.md` and `SPEC.md`. It makes no claim they don't support:
- **Activation:** a bought vault needs its own deposit of at least 21,000 sats in cbBTC to activate (`DESIGN-v6.md:550`).
- **Timing:** no vault joins before charter close plus 30 days, and the first free automatic payout is at close plus 60 days (`SPEC.md:690-695`).
- **Faster payout:** a 100 $GARY burn can pay sooner only after joining, when new funds exist (`HOLDER-GUIDE.md:80-82`, `SPEC.md:693`).
- **Split:** 85% to activated vaults and 15% to the Bank treasury (`HOLDER-GUIDE.md:64`).
- **Opening:** opening on the redeem page returns supported contents, and burning elsewhere destroys them. "Can leave inaccessible" is slightly softer than the guide's "destroyed", but it isn't misleading (`HOLDER-GUIDE.md:142-144`).
- **Rate limit:** at most 2.1% of sealed vaults can open per hour (`HOLDER-GUIDE.md:136`).
- **Gary Club wallets:** they need Gary Club's signature (`HOLDER-GUIDE.md:36`).
- **Scope:** the change is text only.

**Residual risk (unchanged, not a blocker)**
- With a collection set, the Bank site's buy, claim and redeem pages no longer refuse for lack of one. External wallet actions stay gated by the on-chain charter and sale-round conditions, not by Gary flags, as you said.

**Not reviewed**
- The operator's test pass/fail results, byte-identical rebuilds, the signing-service shutdown and the `a9dcaca` artifact being untouched.
- Whether the full-suite rerun passes after pin acceptance.

This is source and pin acceptance only. It is not the Friday lock or any holder financial release.
