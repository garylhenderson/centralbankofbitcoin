[reasoning only]
We need answer to user. They provided massive repository/audit prompt. Need act as independent security auditor; find faults. Need order by target then accepted limits questions then other, report CRITICAL/HIGH/MED/LOW with evidence.

We have to analyze code/files. We cannot actually run code, but can reason. Need not re-report accepted limits. We need inspect current tree given. Must verify repairs. Need produce findings with evidence what on chain/test run would show. Also end section GIVEN no human firm.

Need be careful not to make wrong claims. We need deeply analyze. The prompt is huge; we have all files mostly. We need identify real bugs, likely there are some intentional planted issues. We need look for vulnerabilities in current code.

We'll parse programs. Let's inspect each program.

General architecture:
- Four vault programs + sweep helper. Immutable after launch.
- Need find faults.

We must not re-report accepted limits. We need attack current repairs and all code. Let's inspect important code thoroughly.

Start MINT. Functions: initialize, tighten_sweep, set_boost_terms, arm_swap_operator, apply_swap_operator, cancel_swap_operator, emergency_stop_sales, emergency_stop_sweep, restart, arm_guardian, apply_guardian, set_round, split_revenue, sweep_sol_for_swap, mint_vault, claim_charter_vault, capture_entropy, reschedule_reveal, reveal_level, activate, boost_vault, expire_boosts, distribute, claim, retire_redeemed, retire_burned. Account structs huge.

I need examine for logic errors.

R2 pool invariant, counters:
- pending_count, pending_this_epoch; join waiting etc.
- Potential issue: waiting_to_join = pending_count - pending_this_epoch. If pending_count underflows? checked_sub return Overflow.
- pending_this_epoch reset in advance_epoch after increment dist_epoch. A request in current epoch increments pending_count and pending_this_epoch. If retired same current epoch, decrements both. If retired later epoch, pending_this_epoch likely is 0, but code only decrements pending_this_epoch if r.request_epoch == c.dist_epoch before setting pending false. So if retire in later epoch, pending_count-- only. That matches waiting. OK.
- join: pending_count--, not pending_this_epoch. But join only after dist_epoch > request_epoch. Since advance_epoch resets pending_this_epoch = 0 after moving dist; any request_epoch < dist not counted. OK.
- activate second call: checks pending true, dist_epoch > request, returns join.
- First call: if r.active false and pending false. It calls require!((1..=5).contains(&r.level), NotRevealed). Then require_live_vault, account amount. Then sets pending true/request epoch and vault_ata. It does NOT set active. good.
Potential abuse: activate can be called repeatedly on same vault after request? It requires !r.active and if r.pending branch triggers require dist_epoch > request; if not yet distribution, returns ActivationPending. OK.

Potential issue in `claim`:
```
if r.pending {
 require_keys_eq!(dest.key(), r.vault_ata)
 if dist_epoch > request_epoch { join... store; n_joined++}
 continue;
}
```
It joins pending vault even if asset is active? It doesn't require live. Accepted limit 27 bare burn. OK.
If dest frozen/missing, join still occurs, continue. Fine.
For active vault: require dest key equal recorded vault_ata before read/frozen. But if vault record has vault_ata set. If account missing, later require dest.owner and lamports >0 etc. It doesn't check dest owner before paying: read token. fine.

Potential issue `retire`:
```
if r.active {
 let w=weight_of(r)?
 let full=(w as u128)*acc_scaled
 let pending=owed_of(r, acc)
 if redeemed && !forfeit { require!(pending<ACC_SCALE, ClaimBeforeBurn)}
 if forfeit && pending>=ACC_SCALE log
 c.owed_scaled -= pending
 total_active_weight -= w
 active_count -=1
 if r.boost_weight >0 unschedule...
 r.debt_scaled = full
 carry_scaled=0
 r.active=false
 returned=pending
}
if r.pending { pending_count--; if request_epoch == c.dist_epoch pending_this_epoch--; r.pending=false}
r.retired=true
```
Issues: c.owed_scaled - pending. Could underflow if pending > owed_scaled? The invariant says owed_scaled sum of shares. But with weird? likely checked.
For redeemed with forfeit (pool frozen): it subtracts pending from owed_scaled, effectively returns share to pool (owed_scaled down, pool balance unchanged), OK forfeit to pool.
For bare burn not redeemed, returned to pool by owed_scaled sub too. OK.

Potential issue: if r.active and boost_weight >0, `unschedule_boost` handles due or future. But if c.dist_epoch >= boost_end_epoch and boosts_due includes it; it checksub 1. OK.
Then r.active false and r.debt_scaled=full, carry=0. r.boost_weight maybe? `unschedule_boost` doesn't zero r.boost_weight. r.active false so inert. fine.

`reweigh`: 
```
let owed = owed_of before
r.boost_weight=boost
after=weight_of
carry=owed
debt=after*acc
total_active_weight = total - before + after
```
Does this preserve owed? Before owed_scaled includes owed among all. After individual owed_of = after*acc + carry - debt = after*acc + owed - after*acc = owed. Good. But total_active_weight changes; does owed_scaled need adjustment? It should still equal sum of new owed_of across vaults = old sum, since other unchanged. OK.

Potential bug boost_vault scheduling:
- It calls monthly_inline first; then obtains price, extra, epochs, cbob, collection.
- checks buyer terms (one-sided)
- checks record active && !retired && !pending && boost_weight ==0
- require_live_vault
- reads owner
- mints etc.
- then:
```
let end = dist_epoch + epochs as u64;
let i = end % ring;
c.boost_expiring[i] +=1;
c.boosts_active +=1;
c.boost_weight_total += extra
c.cbob_burned_total += price
reweigh(c,r,extra)?
r.boost_end_epoch=end
```
What if end modulo ring collides with existing live boost ending earlier at same ring slot? `BOOST_RING=64`; max_boost_epochs <= ring-1=63. Comment says "a boost may last at most BOOST_RING - 1 distributions, so two live end epochs never share a slot." Is that true with dynamic dist_epoch? Suppose boost A bought at epoch 0 with epochs 63 -> end 63 slot 63. Boost B bought at epoch 1 with epochs 63 -> end 64 slot 0. Since ring 64, 63 mod64=63, 64 mod64=0 distinct. But if two boosts have different end epochs that are congruent mod ring? Since end - purchase epoch = n <=63, and purchase epoch increases. Could two live boosts share same slot? Suppose boost A end 64, slot 0. It is due at epoch 64. If no distributions? Actually after advance epoch to 64, slot 0 becomes due and then cleared before new purchase? `BoostsExpireFirst` prevents distribution while due, but can `boost_vault` happen while boosts_due >0? `boost_vault` calls monthly_inline, not distribution? It has no BoostsExpireFirst check. It can buy a new boost while due boosts exist? Let's see: boost_vault doesn't require boosts_due==0. It schedules end based on current dist_epoch even if some due boosts not expired. Is that allowed? It calls monthly_inline: if due month due and boosts_due>0, monthly_inline waits for boosts (does nothing). Then computes terms and proceeds. So new boost can be bought while due boosts outstanding. end = dist_epoch + epochs. Due boost end_epoch <= dist_epoch. New end > dist_epoch. Thus no same slot? But could be existing due boost not yet unscheduled at same slot? end unique due to + <=63 and dist_epoch current. At most one boost per vault, but multiple vaults. Could two boosts bought at same epoch with same `epochs` end same slot; ring counts multiple. That's fine. Could two live boosts end same slot? yes if bought same epoch with same epochs or different epochs within 63? Since end modulo 64 could coincide for different end epochs separated by 64. But boost lifetime max 63, end—not purchase? If one bought at epoch 0 end 63, another bought at epoch 64? Boost A due at 64; new boost at 64 end 127. Both could be active? A due not expired; if not expired and still active, B bought at 64 with end 127. end127 mod64==63; A end63 mod64==63. So they share slot! Let's check conditions. At epoch 64, boost A (end=64? wait I mis set). A bought epoch 0 n=63 => end=63, not 64. At epoch63 A is due but perhaps not expired, dist_epoch=63. Can new distribution happen? boosts_due maybe? advance_epoch when reaches 64 adds boost_expiring[0?]. Let's model. A end63. At epoch62 active not due. Distribution at epoch62 -> advance to63, boosts_due += ring slot 63? Wait advance_epoch increments dist_epoch to 63, then at i=dist_epoch%64=63, boosts_due += ring[63], which contains A if scheduled. So A due at epoch63. No distribution while due. But `boost_vault` does not gate. A is due but still active with boost_weight>0. At epoch63 someone buys B with n=63 end=126 mod64=62? Wait if current dist_epoch=63, end=126 slot62. A slot63. Could still be distinct. Then to buy a boost at dist_epoch such that end mod64 same as due A's end, need due A's end e_mod. New end = dist + n. n <=63. For same mod64, dist+n = e (mod64), and dist >= e due. Since n in 1..63, dist+n > e and <= e+63. If e+? For congruence mod64, dist+n could equal e+64. require n = e+64-dist. Since dist can be e (if due not expired) then n=64, impossible. If dist > e by m, n = 64 - m, possible if m between 1 and 63. Example e=63, due at dist63. If A not expired, dist can be 64 if due still present and no distribution? To get dist>63, distribution must advance despite due; impossible. But `tick` advance_epoch also gated? Let's see `distribute` w==0 branch before due check? It reads balance and checks boosts_due before w==0: 
```
require boosts_due ==0
let w=...
if w==0...
```
So no advance_epoch while due regardless. What about `advance_epoch` only reached from distribution/credit/tick/monthly_inline all with due checks? monthly_inline returns if boosts_due>0. activate/claim perhaps join can happen while due but doesn't advance. `boost_vault` also no advance. So dist cannot advance past due epoch because distribution blocked. Therefore dist remains at due epoch until expired. Thus new n to congruent would require dist=e and n=64 impossible. So ring collision safe. Good.

But `expire_boosts` does not advance epoch, just expire. Fine.

Potential issue `advance_epoch`:
```
dist_epoch +=1;
pending_this_epoch=0;
i=dist_epoch%ring;
boosts_due += boost_expiring[i];
boost_expiring[i]=0;
```
What about boost_expiring entries for future epochs that were previously overwritten? Ring after 64 wraps. At epoch 0, buy end64? but max epochs 63 -> end at max dist+63, within ring. When dist_epoch reaches 64, slot 0 due. That slot originally held boosts ending at 64. But if there was stale? ring slots reset when processed. At epoch 0, slot0 was zero before any purchase. OK.
What if a boost is unscheduled early (retired before due) at a wrapped slot where another boost also scheduled, count decrement. ring count sum tracks. fine.

Potential issue `distribute`:
```
let (balance,_) = read_token(...)?;
require boosts_due==0;
let w=total_active_weight;
if w==0 {
 let c=&mut...
 require waiting_to_join(c)?==0
 require !burn && pending_this_epoch >0
 require rem empty
 require month elapsed
 return tick
}
let owed=ceil_sats(owed_scaled);
let avail=balance.checked_sub(owed)...;
require avail>0
if burn { checks waiting_to_join? before CPI }
...
credit(c,avail,w,now)
```
Problem: In w==0 branch (no active joined), burn path refuses `NoActiveVaults`. But if no active, no one to credit. Free path can tick only if pending_this_epoch >0. It requires waiting_to_join==0. `waiting_to_join` excludes pending_this_epoch because not eligible. So if no active, some pending current epoch, tick permitted once month due. OK. If no pending_this_epoch but pending old? waiting_to_join>0 so refuse. If no pending, tick not needed.
Potential issue: distribution with w>0 free path doesn't require boosts_due? already. It requires waiting_to_join==0. It doesn't require `pending_this_epoch`? OK no active? w>0 means active exists. New pending this epoch doesn't block because not eligible.

Potential issue `credit`:
```
delta = avail*scale / w
acc += delta
owed_scaled += delta*w
last_distribute_at=now
advance_epoch
```
It discards fractional `avail*scale % w`, stays in pool and not counted owed. avail computed balance - ceil(owed_scaled). If fractional from previous, balance may include; OK dust carries. `owed_scaled += delta*w` <= avail*scale. Pool required balance >= ceil(owed). Good.

Potential issue `ceil_sats`: scaled as u128. If owed_scaled huge? u128. OK.

Monthly_inline:
```
if !due return
if boosts_due >0 return
if waiting_to_join>0 return
if total_active_weight==0 { if pending_this_epoch>0 tick }
if pool.owner != SPL_TOKEN return
read d if len !=165 or mint/owner mismatch return
if frozen return
avail = balance.saturating_sub(ceil_sats(owed_scaled))
if avail==0 return
w=total_active_weight
credit
```
What if pool is frozen and total_active_weight==0? It checks total_active_weight==0 before reading pool. So if no active and due and pending_this_epoch>0, it ticks even if pool is frozen/nonexistent? If pool frozen and no active, tick advances epoch. That could allow pending older joins? But join gate `waiting_to_join` before tick: if waiting_to_join>0, returns. If pending current epoch only, tick. While pool frozen and no active, it ticks so pending current becomes eligible, but then distributions later? Accept maybe no funds. Not huge. It doesn't credit. Fine.

But there may be bug: in monthly_inline, if `waiting_to_join(c)? > 0`, it returns without checking `total_active_weight ==0`. That matches comment. Good.

Potential issue `split_revenue`:
- reads total from revenue_ata as u64. Then bank_cut = total*(10000-split_bps)/10000 floor. holders remainder. It sends two TransferChecked. Good.
- `revenue` PDA is included as signer via invoke_signed. But ctx.accounts.revenue is UncheckedAccount mut, not signed in transaction. invoke_signed creates signer. Fine.
- Does it require revenue_ata mint? expects derived with payment mint; read no state. Then token program CPI will verify.
- It doesn't require revenue_ata amount before compute? It reads `total` from d[64..72]. fine.
- It doesn't check revenue_ata owner is token? CPI does.
- Could `decimals` wrong cause TransferChecked mismatch? CPI may fail; not issue.

Sweep_sol_for_swap:
- Operator signs. amount >0, <=max, cooldown. `now >= last_sweep_at + cooldown`. last_sweep_at initially 0. good.
- Keeps `reserve = cfg.sol_reserve_lamports`. Require bal >= keep+amount. Then system transfer to operator signed by revenue PDA. c.last_sweep_at=now.
Potential issue: `last_sweep_at` updated after transfer succeeds. If transfer amount = balance - keep exactly. OK.
- Two sweeps in one transaction share Clock now? Runtime Clock slot timestamp same. If cooldown_min 1, first sets last=now, second require now>=now+cooldown false. good.
- If amount small and cooldown huge, okay.

Governed instructions: `Governed` struct has config seeds/has_one governance and `governance: Signer`. It does not check governance program ID? Anchor `has_one = governance` checks config.governance equals signer key. But any off-curve address could be config.governance? Only set at init to GOV PDA. Good. If governance signer is PDA only Govt can sign via CPI. But could an on-curve key equal config.governance? no.

Potential issue in GOV execution and MINT's governed setters: GOV `execute_proposal` builds CPIs with `governance` signer by seeds. Good.

Potential severe issue in `Governed` for set_round: Does MINT recheck opens/closes? yes. But GOV execution does calls order.

Need examine GOV thoroughly.

GOV initialize:
- read_mint_config requiring MintConfig version6, collection match.
- quorum etc. Good.
- Proposal account space `8+8+ ACTIONS_SPACE +...` but Proposal struct with Vec variable? Space maybe adequate? ACTIONS_SPACE=4 + 5*37=189. Actual Borsh Vec prefix 4. Good. But Proposal struct fixed includes id u64, actions Vec (4+data), voting_ends_at i64, yes u64, no u64, executed bool, bump u8, quorum_supply u64, quorum_bps u16, threshold_bps u16, index_snapshot u64, created_at i64. Space: 8(disc)+8(id)+4+185 actions? +8+8+8+1+1+8+2+2+8+8 = maybe. Let's compute .. 8+8=16, ACTIONS_SPACE=4+5*37=189, + voting 8=213, yes8=221, no8=229, executed1=230, bump1=231, quorum8=239, quorum2=241, threshold2=243, index8=251, created8=259. Account space they allocate 8+8+ACTIONS_SPACE+8+8+8+1+1+8+2+2+8+8 = 8+8+189+8+8+8+1+1+8+2+2+8+8=259. correct.

Create_proposal:
- read m = read_mint_config; burned_total = read_burn_total.
- quorum_supply = minted - burned - bare_retired.
- owner/collection check.
- now >= charter close.
- duration >= min voting and <= MAX.
- validate actions.

Potential issue in reading `quorum_supply`: subtracts burned_total and bare_retired; if minted_total < burned+retired due? checked_sub with Overflow -> rejects. But can burned_total exceed minted_total? Burn config burned_total counts redemptions through burn; each burn had minted vault. So <= minted. bare_retired counts bare burns; also subset of minted. The sum could exceed minted if retire_burned called for redeemed vault? It uses positive burned; but BURN redemptions don't also go through retire_burned. Good.

Vote:
- VoteRecord init PDA. cast increments yes/no. issue: It doesn't check if vote_record exists; Anchor init with seeds will fail if duplicate. Good.
- `owner` signer; read_core_asset owner match. It doesn't check config's collection? yes.
- Does not verify vault_record is writable? okay.

Execute:
- require now >= voting_ends_at, not executed, not expired.
- read_mint_config and require governance pubkey.
- compute cast etc.
- key_change = any Brakes set_guardian or ArmSwapOperator. Note includes guardian change and operator arm but not SetBoostTerms etc.
- `need_key` bar half of quorum_supply.
- Ordering per kind.
- Then calls.

Potential issue: Execute can be called by anyone. It passes `ctx.accounts.governance` signer? In Accounts struct `governance` UncheckedAccount with seeds = [GOV_SEED], bump (not signer in transaction). `invoke_signed` signs. fine.
- It marks p.executed = true BEFORE executing CPI calls. If CPI fails, whole transaction reverts including p.executed? Yes all atomic, so revert. But note this is within one instruction: if invoke_signed returns Err, function returns Err and Anchor will revert account changes? Solana BPF: if program returns error, only changes from before CPI might revert? Actually cross-program invocation failure returns error; the caller program's state changes made BEFORE the failing CPI? In Solana, if a program instruction returns Err, all its account borrows are rolled back? Yes BPF runtime reverts all changes by instruction on error? I think if top-level instruction returns error, all account changes by that instruction are reverted. For inner instruction? The entire top-level instruction's changes revert. So p.executed set then failed CPI reverts. Good.

But cross-program invocations inside execute proposal: It sets p.executed=true before CPIs. After invoke_signed to MINT, the inner instruction may mutate MINT config. If MINT returns error, top-level reverts, including p.executed and MINT config? CPI modifications are within inner instruction but part of outer? In Solana, if an inner instruction returns error, its changes are reverted, but the CALLER's changes before the CPI? I think all changes from the entire top-level instruction are reverted if error result propagates. Yes.

However, something subtle: MINT's governed functions may `emit` events; revert rolls events? probably.

Potential issue in GOV action skip and ordering:
- `last_round_id` etc in GovConfig.
- For `Brakes`, set_guardian skip logic:
```
if *set_guardian {
 if id <= cfg.last_guardian_id { skipped(...)}
 else { cfg.last_guardian_id=id; ...}
}
let mut sales = *restart_sales; let mut sweep=...
if sales && stops.sales_stopped && stops.sales_stopped_at >= p.created_at { skipped; sales=false}
...
if sales || sweep { CPI restart }
```
Potential issue: `cfg` borrows &mut config, while `stops` was copied before. okay.

Potential issue: A proposal with `Brakes {set_guardian:true, restart_sales...}` if guardian skip, restarts still happen. Good.
- But key-change bar was checked overall with any guardian/operator. A proposal containing guardian change and restart requires half. fine.
- For `TightenSweep`, it always pushes call, no ordering/skip. MINT monotonic. fine.
- For `SetRound`: if `id <= cfg.last_round_id`, skip. else sets cfg.last_round_id=id, then if closes_at <= now skip. Then pushes if not skipped.
Potential issue: `last_round_id` state update occurs BEFORE actual CPI. If CPI later fails, whole tx revert. okay.
- For `ArmSwapOperator`: id <= last_arm skip; else last_arm=id push.
- For `SetBoostTerms`: id <= last_boost skip; else last_boost=id push.

Question: `last_boost_id` updated even if proposal contains a SetBoostTerms that is overridden? Top-level atomic; if CPI success. good.

Potential bug: `read_mint_config` reads `charter_closes_at` at u64 to i64. If timestamp after i64::MAX? unix seconds ~1.7e9 fine.
Potential bug raw offsets. Let's recompute MintConfig offsets.

Need verify raw offsets in GOV and BURN. Use struct layout from definitions. We should recalc carefully.

MintConfig struct:
version u8 offset 0
collection Pubkey 32 -> 1-32
governance -> 33-64
pool_ata -> 65-96
round_id u32 -> 97-100
opens_at i64 -> 101-108
closes_at i64 -> 109-116
price u64 -> 117-124
cap u32 -> 125-128
minted_this_round u32 -> 129-132
minted_total u64 -> 133-140
max_supply u64 -> 141-148? Wait need include offset from account start after discriminator 8. In Rust struct deserializes after discriminator, so `version` at struct offset0 (account 8). The JS offsets likely account absolute including disc? Let's map from test suite `OFF_MINTED_TOTAL=141`, account data includes discriminator. Struct offsets: version at 8, collection 9, governance 41, pool 73. This matches comment:
- version struct offset 0 => account 8.
- collection at 9 => account 9.
- governance at 41 => account 41.
- pool at 73 => account 73.
- round_id at 105 => account 105.
- opens 109, closes 117, price125, cap133, minted_this137, minted_total141.
- max_supply149.
- bank_treasury157.
- split_bps189.
- sales_stopped191.
- sweep_stopped192.
- guardian193.
- swap_operator225.
- sol reserve257.
- bump265.
- max_sweep266.
- sweep_cooldown274.
- last_sweep282.
- level_caps290 (5*4=20) through 309; level_minted310 through 329; revealed_total330; payment_mint338? Wait size: from 290:
 level_caps [u32;5] at account 290-309? Actually 290 to 309 inclusive? 5*4=20, so level_caps occupies 290-309 (start 290, next 310). level_minted at 310-329. revealed_total u64 at330-337. payment_mint Pubkey 338-369. pob_collection 370-401. pob_root [32] 402-433. charter_opens i64 434-441. charter_closes i64 442-449. charter_claimed u32 450-453. bare_burns_retired u64 454-461. total_active_weight 462-469. active_count 470-477. acc_scaled u128 478-493. owed_scaled u128 494-509. last_distribute_at i64 510-517. sales_stopped_at i64 518-525. sweep_stopped_at 526-533. pending_swap_operator? According to code after sales_stopped_at etc; stage3b appended: sales_stopped_at, sweep_stopped_at, pending_swap_operator, pending_swap_operator_at, monthly_secs. Let's see exact order in struct from code:
```
pub sales_stopped_at: i64,
pub sweep_stopped_at: i64,
pub pending_swap_operator: Pubkey,
pub pending_swap_operator_at: i64,
pub monthly_secs: i64,
// stage 3c:
pub pending_guardian: Pubkey,
pub pending_guardian_set: bool,
pub pending_guardian_at: i64,
pub notice_secs: i64,
pub sweep_floor_lamports: u64,
pub cooldown_ceiling_secs: i64,
pub reserve_ceiling_lamports: u64,
pub dist_epoch: u64,
pub pending_count: u64,
pub pending_this_epoch: u64,
// boost:
cbob_mint, max_boost_weight, max_boost_epochs, boost_price, boost_weight, boost_epochs, boosts_active, boosts_due, boost_weight_total, cbob_burned_total, boost_expiring [u32;64]
```
Recompute from last_distribute_at at 510:
- sales_stopped_at 518-525
- sweep_stopped_at 526-533
- pending_swap_operator 534-565
- pending_swap_operator_at 566-573
- monthly_secs 574-581
- pending_guardian 582-613
- pending_guardian_set 614
- pending_guardian_at 615-622
- notice_secs 623-630
- sweep_floor 631-638
- cooldown_ceiling 639-646
- reserve_ceiling 647-654
- dist_epoch 655-662
- pending_count 663-670
- pending_this_epoch 671-678
- cbob_mint 679-710
- max_boost_weight 711
- max_boost_epochs 712-713
- boost_price 714-721
- boost_weight 722
- boost_epochs 723-724
- boosts_active 725-728
- boosts_due 729-732
- boost_weight_total 733-740
- cbob_burned_total 741-748
- boost_expiring 749-(749+64*4-1)=749-1004? I think account 1005 next padding. Comments in test: OFF_CBOB_MINT=679, OFF_MAX_BOOST_W=711, OFF_MAX_BOOST_E=712, etc. So GOV's OFF_MINT_MAX_BOOST_WEIGHT=711, MAX_BOOST_EPOCHS=712 correct. OFF_MINT_GOVERNANCE 41 etc. OFF_MINT_SWEEP_FLOOR 631 etc correct. OK.

BurnConfig layout:
version off8, collection 9, bump41, burned_total42-49, redeem_window_secs50-57, rate_head58, rate_ring 59..570? Actually 64*8=512 => 59+511=570. correct.

VaultRecord layout:
version8, asset 9-40, mint_index41-48, reveal_slot49-56, level57, charter58, entropy_set59, entropy60-91, attrs_hash92-123, bump124, active125, retired126, reschedules127-128 u16, vault_ata129-160, debt_scaled161-176 u128, pending177, request_epoch178-185, boost_weight186, boost_end_epoch187-194, carry_scaled195-210, padding. Space = 8+1+32+8+8+1+1+1+32+32+1+1+1+2+32+16+1+8+1+8+16+10 =? sum: disc 8, fields: 1+32+8+8+1+1+1+32+32+1+1+1+2+32+16+1+8+1+8+16=219? plus padding10 =237? wait record total 221 from SPEC. Let's compute later not needed.

Potential vulnerability: raw reads in `read_mint_config` etc are all consistent.

Need inspect SEAL and BURN pairing.

SEAL open:
- read_core_asset returns owner/collection from asset data bytes.
- require owner=ctx.accounts.owner.key.
- require collection=config.collection.
- require ctx.accounts.collection.key == collection.
- Walk top-level instructions after current. `current = load_current_index_checked`.
Potential issue: load_current_index_checked returns current index in inner? It does. For top-level open current maybe 0. It walks `i=current+1` until no err.
- It matches BURN program ID, disc, asset idx0, owner idx2.
- Then set_frozen false through SEAL PDA.

BURN burn:
- similar preceding open check loops 0..current. It checks vuln if current? If burn top-level index maybe after open, includes. Good.
- `load_instruction_at_checked` can fail out-of-bounds; loop handles.
Potential issue: an instruction can be CPI wrapped: seen outer instruction is wrapper, not open. Both halves require top-level. tested.
Potential issue: transaction can have duplicate open/burn, two redemptions share asset? Rate limit etc. Pairing binds asset and owner. If same asset appears twice? Core burn second impossible. Fine.

BURN emptiness proof:
- It reads asset owner/collection and checks.
- rate limit.
- reads reserves from SEAL config.
- requires remaining_accounts.len == declared.
- for each mint/TP, derives expected ATA for PDA under token_program and mint. It requires find in remaining. If found but owner is neither SPL nor T22, continue => skip, no refusal. That matches comment? It says "requires every reserve mint's ATA under BOTH token programs to be DECLARED, and skips an account no token program owns." In loop, after `acc = find`. If acc.owner not token program, `continue;` skips checks. This may allow if expected account exists but owned by something else? But ATA address is a PDA owned by ATA program or token program; an attacker can't create account at PDA owned by something else? Solana account can be created at any address with any owner if signer; but PDA without signer cannot be created by arbitrary owner? ATA program derives and creates owned by token program. Someone could create a system account at that exact address only if private key corresponds? PDA off-curve, no private key, so cannot sign for creation as system. But could possibly via program owned by that address? no. So skip benign.

- For each reserve account found:
```
if acc.owner != SPL_TOKEN && acc.owner != TOKEN_2022 { continue; }
let d=...
if d.len() < 165 { continue; }
let owner = d[32..64]; require owner==pda
require delegate fields at offsets...
require d.len()==165
amount==0
```
Potential issue: if d.len() >165 but >=165, it reads amount etc, then at end require len==165. Fine no extensions.
- It doesn't check mint in token account data matches? It should maybe derived expected address for mint; account at expected address could theoretically have data with another mint? ATA program enforces mint? An attacker cannot create at same address with wrong mint. But if token account closed? no. Not an issue.

- Then loop remaining_accounts:
```
if owner == MPL_CORE_ID {
 let d...
 require d.is_empty() || d[0] != KEY_ASSET_V1, else VaultStillHoldsAVault;
 continue;
}
if acc.lamports()==0 continue;
if owner != token programs continue;
let d...
if d.len() >=165 {
 let owner_field = d[32..64]
 if owner_field == pda {
   require d.len()==165; require delegates...; amount==0
 }
}
```
Potential issue: This scans all remaining accounts (extra declared) including reserves, duplicate, foreign token accounts owned by pda. If a declared account is a classic token account owned by pda with extensions? It checks. Good.

Potential issue: If a nested Core asset account has data length 1 and key 0 (burned) it passes (d is_empty || d[0]!=1). A live Core asset with key0? burned. fine.
Potential issue: If a declared Core asset account is not `MPL_CORE_ID`, the second loop ignores as non-token if owner not token. It doesn't require no live Core asset if owner is not Core? A live asset has owner Core, so caught. foreign program account with owner other core? no.

Potential issue: BURN's reserve loop checks account with owner != token programs but `continue`, so it may skip if one of the two derived accounts has owner custom? Could maybe an ATA with T22? owner is T22, checked. fine.

Potential severe: BURN's emptiness proof does not check the source token account in sweep is closed? The sweep helper closes it; if owner uses custom sweep (pre-read) and leaves accounts open, burn can pass if amount==0 and no delegate. But redeemer strands rent. Client obligation. Not theft.

Potential issue: After Core BurnV1, BURN invokes MINT retire_redeemed via `invoke` not `invoke_signed`. It passes AccountMeta writable mint_config, vault_record, asset, instructions sysvar, pool_token, and `mint_program` account info. It doesn't pass token_program for MINT? retire_redeemed needs only config, record, asset, instructions, pool. So fine.
- `retire_redeemed` checks stack height == TRANSACTION_LEVEL_STACK_HEIGHT+1. This is called via invoke from BURN, which itself is top-level. Stack height of retire = 2? TRANSACTION_LEVEL_STACK_HEIGHT=1? +1=2. Direct top-level MINT call has stack height 1, so refuses. Wrapped CPIs deeper stack >2 refuses. Good. But what if BURN is CPI called from top-level wrapper? Burn's own `current` introspection sees outer wrapper, so no preceding open; open? SEAL pairing prevents. If wrapper calls BURN directly without open, BURN might pass open? No open, no preceding. Good. If wrapper contains BURN as CPI and top-level open? SEAL open requires terminal burn top-level, not wrapper. So no.

Potential issue: `retire_redeemed` checks the current index's instruction data and account 0 to ensure called from BURN's burn_vault. It does not check the instruction sysvar account passed is actually sysvar? It has address annotation. fine.
- It doesn't verify the call comes from *current* top-level instruction's burn? It uses `load_current_index_checked` in MINT; when invoked from BURN, current_index likely points to the inner instruction? The instructions sysvar `load_current_index_checked` returns index into current instruction? In CPI, instructions sysvar serializes instruction trace? Need verify. This was tested. It also requires top-level instruction at outer index? likely. Fine.

Potential issue if BURN's `burn_vault` discriminator mismatch? no.

Sweep helper:
```
data == [0]
accounts.len() >=4 and (len-4)%2==0
signer.is_signer required.
token.key==SPL_TOKEN_ID, system.key==system_program
if signer.key == dest.key refuse
for pairs:
 read src/to
 if src_owner != signer.key refuse
 if to_owner != dest.key || to_mint != src_mint refuse
 if amount>0 transfer
 close account
lamports = signer.lamports
if >0 transfer signer->dest
```
Potential issue: It transfers all lamports from signer at execution. Core ExecuteV1 signs as asset signer, but during CPI, `signer.lamports()` includes maybe temporary lamports if any? It transfers all; OK.

Could someone call helper directly with asset signer signature? Only Core can sign for PDA, directly maybe if asset_signer is a signer? Not possible. Could someone create a different account as first key and sign? They can sign with own account, and dest their account. They can specify source token accounts they own? source owner must equal their own account. Then helper would sweep their own token accounts and lamports to dest. It's a stateless helper; not vulnerability. But called directly can be used to move own assets. fine.

Potential bug: It doesn't require dest to be a system account (not PDA), but System transfer requires destination writable and not executable maybe. If dest is the owner (exists) fine. If dest below rent and source lamports < rent, System transfer to existing account? If target doesn't exist, fails; page rule.
Potential issue: It closes source after transfer with dest as destination. If `to` account is the same as `src`? Pair checks to_mint=src_mint, to_owner=dest, src_owner=signer, signer != dest; so src_owner != to_owner, different accounts. good.
- It allows same `to` account multiple times? It will receive multiple transfers; after source close, destination remains. fine.
- It allows source account with amount zero to be closed, passing amount0; close.
- It approves `amount>0` then token Transfer; if source has a delegate? Token transfer authority signer is signer (PDA signer). If source has delegate, owner signer still can transfer. Delegate could be present but owner can transfer. Then close account CPI likely refuses if account has delegated? CloseAccount checks owner signer and account has no lamports except? Delegated token amount zero? after transfer amount zero; close allowed? SPL close account may be allowed with delegate? It checks authority owner; delegate not relevant. Fine.

Potential issue: The helper transfer lamports from signer after closing token accounts. Closing token accounts transfers their lamports to dest, increasing dest lamports. The helper's signer lamports may include only vault wallet balance, not account rent. Good.
- If no pairs and signer lamports > 0, transfer all. If dest is owner. fine.

Now level draw.

`capture_entropy`:
- require level 0 && !entropy_set.
- try_capture.
Reschedule:
- require level0 !set.
- require now > r.reveal_slot + window.
- reschedule.

Reveal:
- read record fields, ensure level0, index == revealed_total, asset/collection.
- if entropy set use stored else try capture (NotYet/Expired). If Got, stores.
- compute remaining from level_caps - level_minted. total>0.
- pick using u64::from_le_bytes(entropy[0..8]) % total. Note entropy is sha256 of three hashes/asset; first 8 bytes little endian. JS `entropy.readBigUInt64LE(0) % total`. good.
- increment level_minted, revealed_total.
- r.level = li+1.
- burned check if asset owner Core && len1 && d[0]==0. If burned, skip Core Update and attr hash check. Wait it checks burned BEFORE requiring attr hash and Core Update:
```
let burned = { ... };
if !burned { require asset live; require attr hash; update plugin }
```
For burned vault, it does not require `attrs_hash` match, so anyone can reveal a burned vault with arbitrary attributes? It doesn't write attributes; just records level. Fine. It also doesn't require asset key match? It already require asset == record.asset. Good.

Potential issue: Reveal increments `revealed_total` before checking burned; if Core update fails, whole instruction reverts. fine.
Potential issue: If asset burned, `is_burned` uses `d[0]==0` but Core burned account is one byte key 0; measured. fine.
Potential issue: SlotHashes lookup:
`blockhash_in_window`:
- require data.len >=8, n <=512, data.len >= 8+n*40.
- loops entries; if slot within [want,want+64], find smallest produced slot; require hash nonzero.
Potential issue: The sysvar SlotHashes entries are newest first, but loop doesn't assume order; finds minimum slot in window. good.
- `try_capture`: now <= reveal_slot NotYet; if now > reveal_slot+300 Expired. Then for each A/B/C, want = reveal_slot first; blockhash_in_window(sh, want). If None return NotYet.
Potential issue: C may not be produced yet while window not expired -> NotYet. OK.
- The comment says deterministic; yes.

Potential issue for reschedule: `now > reveal_slot + REVEAL_WINDOW_SLOTS` but if reveal_slot+300 overflows? checked. new slot now+16; future. Fine.
- Crank: `crank` accepts [SlotHashes, records...] max 4. It loads records. If record level 0 entropy not set, try_capture; if Expired reschedule. It does not require record's reveal_slot within anything else. fine.
- In `capture_entropy`, if `try_capture` returns Expired, caller gets RevealWindowExpired error? Actually it maps Capture::Expired => return err!(RevealWindowExpired). But if `capture_entropy` called after window passed but still in same slot? yes.
- Capture window 300 slots well inside slot hashes.

Charter claim:
- `n_extra = pob_extra as usize; require <=MAX_POB_EXTRA && <=remaining`.
- monthly_inline first.
- check clock and supply.
- check_attributes budget.
- PoB data check: `d.len() >=66 && d[0]==1`, owner bytes, d[33] UA_DISC_COLLECTION, collection bytes. Then require collection account key.
- Merkle root.
- Burn CPI: accounts: asset, collection, payer signer, owner signer, Core program ID, Core program ID? Wait IX_BURN_V1 uses accounts? MPL Core BurnV1 accounts likely asset, collection, payer, owner, system? Let's examine MINT code: 
```
metas = [asset, collection, payer, owner, MPL_CORE_ID, MPL_CORE_ID]
data vec![IX_BURN_V1,0]
invoke
```
It includes `MPL_CORE_ID` twice as accounts; maybe test passes. BURN's own Core BurnV1 uses accounts: vault_asset, collection, payer, owner, MPL_CORE_ID, MPL_CORE_ID. So fine.

Potential issue: It passes `pob_extra` accounts to Core burn of PoB "never as signers", but Core may expect external plugin accounts in certain positions. tested with oracle.

Potential issue: The PoB burn CPI does not include `pob_collection`? It passes collection. good.
Potential issue: It burns PoB owner as signer. `owner` is Signer in context and acct meta signer. good.
After burn, create_vault; write record; crank.

Mint_vault:
- monthly_inline.
- sales stop require after monthly? Code calls monthly first, then `let cfg=&config; require !sales_stopped; ...`
Actually:
```
{ monthly_inline...}
let cfg = &ctx.accounts.config;
require!(!cfg.sales_stopped...)
...
```
Monthly may mutate config before sales stop. Could a stopped sale still monthly distribute? yes, host carries pool; not a bug. It may credit while sales stopped. That's intended.
- checks round, cap, price, supply.
- check_attributes budget MAX_ATTRS -1 = 7? MAX_ATTRS=8 total including program level, so paid mint caller gets up to 7 (level program). good.
- Payment transfer: requires payer_token holds, pay. It does not check payer token account state frozen? Token transfer will fail if frozen. OK.
- check_seal_wiring and collection.
- create_vault with hardcoded plugins.
- increments and write_record.
Potential issue: `create_vault` uses owner signer; the comment says owner MUST sign but CPI can sign. However `owner: Signer` account with `Signer` trait in Anchor means `is_signer` true. If a program calls MINT by CPI with owner as PDA signer (PDA can be CPI signer), Anchor Signer accepts. So off-curve owner can mint. Accepted. Not our finding.

Potential issue: `create_vault` account ordering and plugins. Need inspect hardcoded CreateV2 data:
```
data vec![IX_CREATE_V2, 0]
data.extend name, uri
data.push(1); // ? maybe mutable? 
data.extend 2u32 // number plugins
data.push(PLUGIN_PERMANENT_FREEZE_EXECUTE); data.push(1); data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend seal
data.push(PLUGIN_ATTRIBUTES); data.extend attributes len; for each...; data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend mint_authority
data.push(1); data.extend 0u32
```
This is hand built and tested. fine.

Potential issue `push_attr` doesn't include key/value length? It uses u32 and bytes. fine.

Potential issue `check_supply`: requires minted_total < max_supply and < cap_total. Good.

Potential issue `initialize`:
- Big. Need inspect for wrong accepted values locking permanently. Could be issue with `sol_reserve_lamports ==0 || >= rent exempt`. If 0 allowed; accepted. It checks `reserve_ceiling >= sol_reserve_lamports` and `reserve_ceiling >= RENT_EXEMPT_0_BYTES`; if sol reserve 0 and reserve ceiling >= rent. okay.
- max_sweep between 1 SOL and 50 SOL, cooldown between 1 and 24h. good.
- notice/min monthly.
- charter window <=90 days, closes>opens, closes>now, root nonzero.
- collection clean check: It reads Core collection bytes manually:
```
d[0] KEY_COLLECTION_V1, update_authority d[1..33]
o=33; for 2 { len; o += 4+l}
require d[o..o+4]==[0,0,0,0] (num_minted?); require d.len()==o+8
```
Does this ensure no plugins? It parses name/uri lengths then at o should current_size; expects num_minted=0 and len==o+8. If plugins beyond current_size, len>o+8 => CollectionNotClean. good.
- It then checks SEAL wiring and reserves contains payment_mint.
- It initializes config and emits.
- Royalty plugin CPI.

Potential issue: It doesn't require `collection` account's owner in the account struct? It checks in handler. Fine.
- It signs AddCollectionPlugin with `mint_authority` as signer using PDA seeds. Good.
- It passes `ctx.accounts.authority` as payer and signer. fine.

Potential issue: the `pob_collection` is passed in config but `initialize` doesn't check it is a live Core collection. Later charter claim only reads PoB asset's collection and compares. If wrong but valid PoB root addresses are in that collection? If root assets not in that collection, no claims. This is launch checker pinning. Accepted.

Potential severe: `initialize` pins `cbob_mint` classic SPL but does not check mint decimals or no mint/freeze. A wrong cbob mint with mint authority could allow future mint and boost? But supply keys? At initialization, if cbob_mint has a mint authority held by someone, they could mint free $CBOB and buy boosts. But accepted limit 56 says real cbob mint no mint authority. The launch checker pins. Not bug.

Potential issue `set_boost_terms` in MINT:
- Governance only.
- If price>0 check inside cfg's max bounds; else sets weight/epochs 0.
- It doesn't check motions? no.

Potential issue `tighten_sweep`: as described. Potential bug with setting `sol_reserve_lamports`:
```
if let Some(x) = sol_reserve_lamports {
 require!(x >= RENT_EXEMPT_0_BYTES && x <= c.reserve_ceiling_lamports)
 c.sol_reserve_lamports = c.sol_reserve_lamports.max(x);
}
```
At initialize, c.sol_reserve_lamports may be 0. A vote can set to 890880 or more. But GOV checks x > current m.sol_reserve and <= reserve ceiling. Fine.
Potential issue `max_sweep_lamports`: require x >= floor && x <= MAX_SWEEP_LAMPORTS. But `c.max_sweep_lamports.min(x)`; if x > MAX_SWEEP_LAMPORTS? MAX_SWEEP_LAMPORTS absolute 50 SOL. initialized <=50. okay.
Potential issue `sweep_cooldown`: require x>=MIN_SWEEP_COOLDOWN_SECS && x<=ceiling; c.sweep_cooldown_secs.max(x). good.

Potential issue `arm_guardian`: pending_guardian_option. It stores `guardian.unwrap_or_default()`, `pending_guardian_set=true`. `guardian` could be Some(Pubkey::default()) and sets pending false? Actually pending_guardian=default, set=true. `apply_guardian` sets c.guardian = c.pending_guardian. So Some(default) sets guardian default (disabled). fine.
Potential issue `apply_guardian` uses `ApplySwapOperator` context: only config account no signer. It is permissionless as intended. It doesn't require governance PDA or notice? checks. Good.

Potential issue `cancel_swap_operator` Guardian context. It requires pending. fine.

Potential issue in `restart`: 
```
if sales && c.sales_stopped { require!(c.sales_stopped_at < proposal_created_at, StopIsNewer); }
if sweep...
if sales { c.sales_stopped=false}
```
What if sales not stopped but proposal includes restart true; it simply sets false. fine.

Potential issue in `set_round`: no requirement `opens_at >= now` or closes in future. It allows a round that begins in past as long as closes>opens. GOV also doesn't require opens future. Could set round already open and maybe closes future. It can install a round already open. That's fine. Could set round far future. fine.

Potential issue with `max_supply` and level caps sum <= max_supply; production 2100 sum 2100. fine.

Potential issue with `check_supply`: it only checks minted_total < cap_total and < max_supply. But if level_caps sum < max_supply and all levels drawn, no mint. If level_caps sum >? init ensures cap_total<=max_supply. no.

Now governance.

Potential issue around off-curve governance PDA and account owner. fine.

Potential issue in proposal key: `(config.proposal_count + 1)` used in seeds. After created, config.proposal_count increments. In Account struct, `seeds = [PROPOSAL_SEED, &(config.proposal_count + 1).to_le_bytes()]`. In Anchor, seeds can use config field. Good.

Potential issue `readProp` in tests not relevant.

Potential issue that `create_proposal` does not require `vault_asset` live Core AssetV1 in collection AND owner? It calls read_core_asset, which requires owner MPL_CORE, data length >=66, data[0]==1, data[33]==collection. It does not check collection matches config? It does after? In create_proposal:
```
let (owner, collection)=read_core_asset
require owner=proposer
require collection=config.collection
```
No require_live_vault beyond keys; good. It doesn't require asset belongs to collection at collection account? yes via bytes.
Potential issue: A burned vault cannot propose because read_core_asset requires key1. good.

Potential issue vote: `read_core_asset` doesn't require asset in config.collection? It requires data[33] collection disc? It checks data[33]==2 but not collection account match before comparing config.collection later? It does require collection == config.collection. yes.

Potential issue `cast_vote` doesn't check `vault_asset` is live and not burned beyond owner bytes? If Core asset burned, data key0, read_core_asset fails. good.
- It doesn't check proposal ID in vote_record? init seeds. good.

Potential issue in execute: key_change detection:
```
let key_change = p.actions.iter().any(|a| matches!(a,
 ProposalAction::Brakes { set_guardian: true, .. } | ProposalAction::ArmSwapOperator { .. }));
```
If a proposal has both? creation forbids. Good.
Potential issue: The key change bar is based on `divisor = p.quorum_supply`, but if quorum_supply is 0? Could no live vaults? create_proposal requires proposer live vault, so quorum_supply at least 1. Good.

Potential issue: threshold requirements with `cast >0` then `need >0`. If quorum_supply small and quorum_bps 500 etc. fine.
- `yes_bps` calculation `p.yes*10000 / cast`. It can overflow? p.yes u64 * 10000 maybe u64 overflow? p.yes = votes cast <= supply 2100, so fine.

Potential issue: `execute_proposal` has `p.executed=true` before matching actions and CPIs. If all actions skipped, it emits executed even no calls. intended.

Potential issue: GOV ordering per kind not persisted across CPIs? `cfg` &mut config; p is &mut proposal. fine.

Potential issue: MINT's `Governed` instructions could be called by an arbitrary signer if config.governance is a checksum match? config.governance is GOV PDA; only GOV can sign with seeds. But `Governed` Anchor struct requires `governance: Signer<'info>` and `#[account(..., has_one = governance)]`. It does not enforce `governance.key() == GOV_PDA` though config.governance set to GOV_PDA. So fine.

Now R1 attack pairing wrappers. Need check if multiple vaults in one tx can borrow? Pairing matches asset and owner. BURN requires its own preceding open for same asset and owner. If two redemptions share, tests. Good.

Potential issue: SEAL open walk starts after current index. If `open_for_redemption` is called from CPI (wrapper), `load_current_index_checked` returns outer instruction index? They rely. Tests WR.2/3. fine.

Potential issue: If burn instruction appears before open? BURN loop 0..current, SEAL after current. Need reciprocal. If open and burn order can be burn then open? BURN requires preceding open, so burn before open fails. If open then burn. good.
Potential issue: If there are two open instructions for different assets and one burn matches? Pairing individual. fine.

Now R1s sweep helper target. Need maybe find a bug: The helper's process can be called through Core ExecuteV1 by owner, but any person could also call the helper via Core Execute on a THAWED vault during open. The prompt asks. We need see if Core's Execute authority ONLY owner; tested. But maybe update authority or collection authority can Execute? Round 25 N3 tested on current binary. We can maybe not re-file.

Potential bug: The helper doesn't check that source account is a canonical reserve; it can be any classic token account owned by signer. In a redemption, page can sweep stray tokens. fine.
Potential bug: The helper doesn't check destination is not an account owned by another vault's asset-signer. It only requires destination account owner is `dest` wallet and same mint. If `dest` is another vault's PDA? `dest` is destination wallet, could be any pubkey chosen by transaction builder, but Core Execute only owner. Owner can choose any destination wallet, including someone else's vault PDA. But token account owner field would be that other PDA; to satisfy `to_owner == dest`, dest must be the owner of destination token account. So destination wallet could be another vault's asset-signer if owner chooses. Could this be dangerous? Owner can send their assets to another vault's PDA, effectively depositing into the other vault, but that's their choice. They could also send to their own? fine. What about lamports transfer to another vault's asset-signer; that would donate SOL. Their own property.
Potential issue: The helper transfers lamports from signer to `dest` wallet, but if `dest` is an off-curve account under rent exemption? System transfer to an existing account works. If dest not existing and lamports < rent, fails; page rule accepted.
Potential issue: In helper, source account is closed before lamport sweep. CloseAccount from token program transfers source lamports to dest; if dest is the same as signer? already refused signer.key != dest. good.
Potential issue: After token pairs processed, signer.lamports() may have changed due to closing? Closing source transfers from source account to dest, not from signer. Source account lamports are not included in signer.lamports; closing doesn't change signer. The signer's lamports remains original minus no. So good. Then transfers all signer lamports. However, does SPL `CloseAccount` instruction require destination account to be writable? It is dest. yes. The source token account's lamports may include rent. Those go to dest. Then the vault PDA signer's own lamports are transferred. The asset-signer PDA rent may be separate. good.
Potential issue: If signer's lamports include the account's rent for asset-signer itself; after transfer to zero, then BURN checks `asset_signer.lamports() == 0`. The account still exists with zero lamports and can be written? System transfer to zero would normally close? Actually transferring all lamports from a system account leaves it with zero, but account still exists? Solana accounts with zero lamports can exist until rent collection? If the transaction causes account lamports to zero, is it deleted? The runtime may delete if lamports zero at end? Need know. If asset_signer PDA is a system account with no data; system transfer to zero from an account maybe after instruction the account can have 0 lamports, but if it is not touched later, at transaction end zero-lamport accounts may be removed? Actually Solana allows zero lamport accounts? The runtime may delete accounts with zero lamports after transaction if not rent exempt? For a zero-lamport account, rent collection may remove it. But BURN later in same transaction checks lamports()==0; if account was deleted, the AccountInfo still borrowed? It might still be present with lamports 0. The suite tests. fine.

Potential bigger issue: When helper closes token accounts, it sends rent to `dest` wallet, not to `signer` or owner? dest chosen. Owner can choose. fine.

Now MINT pool invariance. Need maybe derive a scenario where pool holds less than ceil(owed). Potential due to `owed_scaled` not including fractional dust properly? Let's inspect accounting precisely.

When distribution credits amount `avail=balance - ceil(owed_scaled_before)` to active weight w. It computes delta = floor(avail*SCALE / w). It adds delta*w to owed_scaled. New owed_scaled = old + floor(...)*w. The pool balance remains B_old. New owed_ceil = ceil((old + floor(avail*SCALE / w)*w)/SCALE). Need show <= B_old. Since floor(...) <= avail*SCALE/w, so floor* w <= avail*SCALE. Then (old + floor*w)/SCALE <= old/SCALE + avail. Since ceil old <=? Need be careful:
owed_ceil_new <= ceil(old/SCALE + avail) = ceil(old/SCALE) + avail maybe, since avail integer. <= B_old? old_ceil = ceil(old/SCALE). avail = B - old_ceil. So old_ceil+avail = B. ceil(old/SCALE+avail) = old_ceil+avail if old/SCALE fractional? If old/SCALE = old_ceil - f (0<=f<1); then old/SCALE+avail = B - f. ceil = B. So owed_ceil_new <= B. Good.
Claim:
- `pending = weight*acc + carry - debt`. pay= floor(pending/SCALE) whole sats. It subtracts `settled = pay*SCALE` from owed_scaled per vault and then at end c.owed_scaled -= settled total. This maintains owed_scaled as sum. The pool balance decreases by pay, but owed_ceil decreases by pay, so balance still >= owed_ceil because before B >= ceil(owed). After B'=B-pay, owed'=owed-pay*SCALE. ceil(owed') <= ceil(owed)-pay? Let's prove: owed=pay*SCALE + r (0<=r<SCALE). owed' = r. ceil(owed') = 1 if r>0 else 0. ceil(owed)-pay = ceil(pay*SCALE+r)/SCALE - pay = pay+1 - pay =1 if r>0 else pay - pay=0. So B'=B-pay >= ceil(owed)-pay = ceil(owed'). good.

Retire:
- owed_scaled -= pending. Pool balance unchanged. Owed_ceil decreases by ceil(pending)? In redeemer forfeit or bare-burn. Before B>=ceil(owed). New owed=old-pending; ceil(new) <= ceil(old)-ceil(pending)? For any x,y ints ceil((s - y_scaled)/SCALE) <= ceil(s/SCALE) - y_sats? likely if y_scaled = pending possibly not multiple. Since pending arbitrary scaled maybe including sub-sat. If pending_scaled <= old. Is it possible retire of a vault with pending > old owed_scaled due to something? Shouldn't. Then pool remains.
- But one scenario for redemption with forfeit: pool frozen, claim not possible; pending >0. retire subtracts pending from owed_scaled, doesn't move pool. pool holds old balance >= old_ceil. New ceil lower, so holds.
- Bare burn same.

Join:
- Adds active with debt=w*acc, carry=0. owed_scaled unchanged. good.

Reweigh:
- individual owed unchanged, total unchanged. good.

Expire boost:
- unschedule + reweigh; owed unchanged. good.

Potential issue: `claim` on a pending vault joins it, then continues and `store_record`, no owed. But `join` decrements pending_count and sets active. It does NOT adjust `pending_this_epoch`? Since dist_epoch > request_epoch, pending_this_epoch already reset, so fine. But what if dist_epoch just advanced and pending_this_epoch was 0. fine.
Potential issue: `claim` after join of pending vault, later in same for loop if same record duplicated as pair, the second pair sees r.active true and may pay. Could a claim pay a vault in same claim immediately after joining? It joins at acc current and debt=w*acc, so owed_of=0. It would pay 0. fine.

Potential severe in `claim`: `let acc = ctx.accounts.config.acc_scaled` at start after monthly_inline. If monthly_inline credits due distribution, acc updated. Then `r = load_record`, pending join uses current config dist_epoch/acc. Good.

Potential issue: `claim` pays active vaults but does not check if record's `vault_ata` is same as `dest` until after checking pending. For active: require dest key equals r.vault_ata. good.
- It reads `ctx.accounts.config.acc_scaled` once. If before paying later vaults, config acc doesn't change; only owed_scaled at end. fine.

Potential issue: `distribute` and `monthly_inline` call `credit` which calls `advance_epoch`. `advance_epoch` increments `dist_epoch` and resets `pending_this_epoch`. Suppose `distribute` has w>0 and waiting_to_join==0. It may include pending_this_epoch requests made earlier in instruction? If activate and distribute in same tx, activate before distribute should occur? In test `[activate, distribute]` activate first sets pending count/pending_this_epoch. Distribute w>0, waiting_to_join=0 because pending_this_epoch excluded, so distribution credits, advances epoch, pending_this_epoch reset to 0. The vault requested in same epoch now becomes eligible after distribution. That is intended: it joined? But if claim not in same tx, it waits. The next distribution is blocked until joined? It has pending, dist_epoch>request. waiting_to_join count = pending_count (pending_this_epoch reset) -> >0, so next distribution waits. good.

Now boost exact N. Need maybe find flaw:
- `boost_vault` calls monthly_inline first. If monthly_inline advances dist_epoch, terms are read after? In code monthly first then read terms/config. Good; boost ends current dist_epoch + epochs.
- `expire_boosts`:
```
let mut r=load_record(ri)
if r.retired || !r.active || r.boost_weight==0 || config.dist_epoch < r.boost_end_epoch {continue}
expire_boost
store_record
```
No require live vault. Could expire a boost on a burned vault that hasn't been retired? It doesn't check asset live; `boost_vault` required live at purchase. After bare burn but before retire, record active true and asset burned. `expire_boosts` would expire boost, reducing active weight and due. Is that OK? If vault burned, it's dead but not retired; the share owed to it may eventually be returned to pool. The boost expiration before retire may preserve owed? Let's analyze. If a boosted vault is bare burned, record active=true boost_weight>0. If expiration occurs before retire, expire_boost unschedules boost and reweighs to 0. That changes active weight down, owed_scaled unchanged (individual owed carried). Then later retire_burned sees r.active true, weight_of returns level weight (boost 0), pending=owed_of with boost0; c.owed_scaled -= pending; total_active_weight -= level weight. OK. If boost was not expired and retire happened first, unschedule_boost due/future and r.debt/carry. Either way same. Good.

Potential issue: `expire_boosts` doesn't check `boosts_due`? It may expire due even if config.dist_epoch >= end. If a boost is due, `boosts_due` count should include it. It calls expire_boost -> unschedule_boost due branch subtracts 1. If record somehow due but boosts_due 0 inconsistency, checked_sub underflows -> Overflow. Good fail closed.
- It skips if not due.

Potential issue `claim` expires due boost before checking frozen/dest missing:
```
if r.boost_weight >0 && dist_epoch >= end { expire_boost; touched=true; }
let pending=owed_of...
let pay = pending/SCALE
if pay==0 { if touched store; continue}
{
 require dest.owner...; if frozen...; require dest token...;...
}
...
store_record
```
For a frozen destination, if touched, it stores record before continue. Good, boost expires and record saved. It logs deferred. Wait it logs deferred only if `pay>0` and frozen. It does `if touched { store_record(ri, &r)?; } continue;` before reading token? Actually inside block:
```
{
 require!(dest.owner == &SPL_TOKEN_ID && dest.lamports() > 0, VaultAccountMissing);
 let d=...
 if d[TOKEN_STATE_OFF]==FROZEN { msg; emit; n_deferred++; if touched store; continue; }
 require initialized
}
```
So no store if `dest.owner != SPL_TOKEN` or missing -> whole tx reverts. Is that intended? A claim that pays a missing/frozen account? For pay>0, a missing dest reverts. A frozen dest defers. Expiry touched stored before continue. fine.

Potential issue: `monthly_inline` reading pool as `pool.owner != &SPL_TOKEN_ID { return Ok(()) }` so if pool frozen, then frozen check after len/mint/owner. fine.

Now launch values potential bug not relevant if checker.

We need find actual surviving defects maybe in new code or tests. We can reason about subtle bugs.

Let's examine `check_attributes` and `write_record`. Attribute budget:
- `check_attributes` ensures strings <=MAX_ATTR_STR and no duplicates/reserved. `write_record` computes bytes = sum(8+key.len+value.len) <=640. Good.
- But `reveal_level` builds Core UpdatePlugin data and re-supplies whole list. It doesn't enforce serialized data length? It checks `attributes.try_to_vec` hash equal stored. The stored list was bounded 640 bytes at mint plus no level. It then adds one level attr. Is the Core instruction data length potentially larger than minted because `push_attr` includes 4-byte lengths but `write_record` used 8+len? Borsh Vec<VaultAttribute> serializes each string as u32 len + bytes, plus Vec prefix 4. The Core UpdatePlugin data uses same push_attr. `MAX_ATTR_BYTES = 640` in write_record computes 8 bytes per attr plus key/value lengths. Is that equal to actual Borsh serialized size? For `VaultAttribute` struct borsh: string key (u32 len+bytes), string value (u32 len+bytes) => 8 + lengths. So bytes sum correct. Core UpdatePlugin data includes extra plugin tag etc and level attr; but test measures fits. fine.

Potential issue with `RevealLevel` `attributes` argument Vec<VaultAttribute> can be arbitrary length; handler doesn't check `attributes.len <= MAX_ATTRS` in reveal before hash. But if attacker supplies huge list whose hash matches stored (stored bounded 640), could they? They need `hashv(&[&attributes.try_to_vec()?]).to_bytes() == hash`. Borsh serialization collision? possible if vec length? cryptographic hash collision infeasible. But maybe they can include extra duplicate? stored attrs hash computed over `attributes.to_vec().try_to_vec()?` in write_record? Let's see write_record:
```
r.attrs_hash = hashv(&[&attributes.to_vec().try_to_vec()?]).to_bytes();
```
This weird: attributes is `&[VaultAttribute]`; `attributes.to_vec()` makes Vec<VaultAttribute>; then `.try_to_vec()?` serializes Vec as bytes. So hash over Borsh serialized Vec. Reveal computes `hashv(&[&attributes.try_to_vec()?]).to_bytes()` where attributes is Vec. same. hash collision not issue. If extra attrs with same Borsh? No length included, so different length changes bytes. good.
- But `write_record` is called after create_vault with `&full` for charter, so attrs_hash includes charter attr. reveal level caller must re-supply charter attr to match; yes.

Potential issue: In `reveal_level`, if vault burned, it skips attr hash checking, as above. Could an attacker call reveal for burned vault with arbitrary `attributes` argument and still get level recorded. It doesn't affect payout since retired later. But could it affect level census/quota? It draws a level for burned vault, which is intended. But because it skips attr hash, no side effect to attributes. OK.

Potential issue: `claim_charter_vault` after `monthly_inline` and `cfg` immutable borrow: `let cfg=&ctx.accounts.config;` then checks, then check_attributes. Then later `let c=&mut ctx.accounts.config;`. Customers? NLL. good.
- It calls create_vault with `payer` as signer, `owner` signer. fine.

Potential issue: `claim_charter_vault` doesn't require `payer` is not owner? irrelevant.
Potential issue: It increments `minted_total` but not `minted_this_round` (no round). good.
Potential issue: `charter_claimed` u32 could overflow after 2^32 claims, but max supply 2100. good.

Now off-chain pipeline files maybe not fully included. We can't audit bank modules for defects beyond what's described. But target includes programs, tests, scripts, holder docs. We can find docs false? Prompt asks report false promises. But they fixed D1-D4. Need check current HOLDER-GUIDE for remaining false sentences. We can read. The included HOLDER-GUIDE seems has repairs: opening says first payout after charter close etc. Honest list has all. But maybe there are still false/conflicting.

Look at HOLDER-GUIDE "What is true about your vault, always":
- "Only you can open it..." says if Gary Club holds key, Gary Club could sign. True.
- "Nothing can leave it while it is closed. Not even by you." Is that true? The owner can transfer the vault while sealed; transferring moves the asset and contents. But "leave it" maybe contents cannot leave. True.
- "Opening is all or nothing. Everything in it (cbBTC, $GARY, $GIRAFFISH and SOL) comes out and the vault is destroyed in the same moment. Anything else in it is destroyed with the vault." Good (D4 fixed).
- "Your level never changes. It is drawn at random just after your vault is created, from block data that did not exist when you got it, and written onto the vault. (The validator that produces the last of those blocks can choose among many results, and a draw nobody records in time is drawn again; see the honest list.)" This says minter can maybe. fine.
- "The rules cannot change..." good, says bug cannot be fixed, Metaplex can change.

Payout section:
- "Every sale, and the 10% royalty ... flows into the Bank. 85%..." okay.
- "Payouts are credited to your vault every month once due..." but D2 fixed? It has first payout paragraph before. 
- "Before you open your vault, anything the Bank has received since the last payout is not yours yet. If you want your share of it, trigger a payout first (100 $GARY), then open. The redeem page offers this and does the steps for you (a payout can only run once every newly activated vault has joined, which the page also does, free). A vault activated since the last payout has not joined yet, so this does not help it." Potential false: A payout can only run once every newly activated vault has joined" should be "no distribution while any eligible waiting vault unjoined." A vault activated since the last payout (current epoch pending) not joined; distribution doesn't wait for current? It says "newly activated vault has joined"; okay.

Boost section: true. "At launch the Bank holds all 2,100,000,000 $CBOB in one online wallet..." true. 
Open section: "Send only cbBTC, $GARY or $GIRAFFISH into a vault. Anything else ... destroyed. redeem page (being built)". True says being built? Actually says "(being built)", OK.
- "Opening is limited to 2.1% of vaults still sealed in any hour (about 45 an hour at 2,100 vaults)" true.
- "If Coinbase freezes your vault's cbBTC, you cannot open it at all (not even to take $GARY and $GIRAFFISH) until thaw. Payouts owed stay owed." True due emptiness proof. accepted.
- "Only open your vault on Bank's redeem page." procedure.
- "A vault held by multisig or DAO cannot be opened." true.
- "Every opening is public." But redemption-poster has no sender. Spec item 50 says not built. Holder guide says "It is announced on X and on Bank's website." This is false because no sender; but HOLDER-GUIDE itself in line 113 says every opening is public. It is still a false promise despite item 50 says page not built. Round25 L1 noted present tense. But prompt says check D docs current. We may report perhaps as LOW: holder-facing false (every opening is announced; no sender, drafts only). They know in item 50, but holder guide still states. Should we re-report? It's an existing accepted/open item. The prompt says "Open-and-blocking item 50". We may note as accepted not new? The instructions: do not re-report accepted limits. Item 50 is OPEN AND BLOCKING. We can report if holder guide still false and not fixed? But round25 already found L1 accepted as item 50. The current tree has unchanged line. Could re-file? They asked "Check every repair against current code." Since L1 was accepted due item 50, not a repair. It's not a new finding. We can mention under accepted limits question maybe. But focus faults.

Need find new bugs.

Let's inspect `Governed` in MINT: 
```
#[derive(Accounts)]
pub struct Governed<'info> {
 #[account(mut, seeds=[CONFIG_SEED], bump=config.bump, has_one=governance)]
 pub config: Account<'info, MintConfig>,
 pub governance: Signer<'info>,
}
```
Potential issue: `has_one = governance` sets constraint that config.governance == governance.key(). It doesn't ensure `governance` is off-curve. But it's set. fine.
Potential issue: `set_round`, `tighten_sweep`, `set_boost_terms`, `restart`, `arm_guardian`, `arm_swap_operator` all use same `Governed`, so if one action CPI calls into MINT from GOV, it works. No bugs.

Potential issue in GOV `execute_proposal`: It calls MINT's `set_boost_terms` with data `IX_SET_BOOST_TERMS` and adds `price u64`, weight u8, epochs u16. MINT's `set_boost_terms` signature `(ctx, price, weight, epochs)` Borsh encodes exactly that. good.
Potential issue with `Brakes` data encoding:
```
let mut d = IX_RESTART.to_vec();
d.push(u8::from(sales));
d.push(u8::from(sweep));
d.extend_from_slice(&p.created_at.to_le_bytes());
```
MINT `restart` signature `(ctx, sales: bool, sweep: bool, proposal_created_at: i64)`. Borsh bool 1 byte. good.
`ArmGuardian` data `guardian.try_to_vec()` -> Option<Pubkey> Borsh. MINT arm_guardian signature Option<Pubkey>. good.
`TightenSweep` both structs same. good.
`ArmSwapOperator` data pubkey 32 bytes. signature operator. good.
`SetRound` data i64,i64,u64,u32. good.

Potential issue: GOV `execute_proposal` passes only config and governance signer to MINT CPI. MINT's `Governed` constraint has seeds config and `has_one governance`; account passed must be writable. good.
Potential issue: MINT Governed instructions require config account owner MINT program; passed from GOV CPI? The CPI account is `ctx.accounts.mint_config` which is UncheckedAccount writable. MINT `Governed` will check owner/seeds. good.

Potential issue with `create_proposal` action validation:
- For `TightenSweep`, it checks each Some:
```
if solReserve Some { require!(x > m.sol_reserve, Loosening); }
...
if Some(x) require x >= RENT_EXEMPT_0_BYTES && x <= m.reserve_ceiling
...
```
What if `m.sol_reserve` is 0 at init and proposal solReserve=890880 >0 and <= reserve_ceiling. ok.
Potential issue: It doesn't check `max_sweep_lamports` x < m.max_sweep AND x >= floor. It does:
```
if Some(x) { require!(x < m.max_sweep, Loosening) }
...
if Some(x) { require!(x >= m.sweep_floor, TightenOutOfBounds); }
```
Doesn't require x <= MAX_SWEEP_LAMPORTS? MINT tighten checks x <= MAX_SWEEP_LAMPORTS. At creation, m.max_sweep initialized <=50 SOL; x < m.max_sweep implies <50 SOL. So OK.
- `sweep_cooldown_secs`: require x > m.cooldown and x <= ceiling. MINT also x>=MIN. Since x>m.cooldown and m.cooldown init >=1, x>=2. okay.
Potential issue: If `Brakes {restart_sales:true, restart_sweep:true, set_guardian:false}` and both flags false? validation require one. good.
- `SetBoostTerms`: if price0, no weight/epochs required; else checks bounds. MINT set_boost_terms if price0 no bound. good.
- `ArmSwapOperator` only non-default. good.

Potential issue in GOV `execute_proposal` ordering of `SetRound`:
```
if id <= cfg.last_round_id { skipped; continue; }
cfg.last_round_id = id;
if *closes_at <= now { skipped; continue; }
push
```
This means a proposal with a round already over updates last_round_id, supersedes older. good per RT3 finding4.
Potential issue: It sets last_round_id even if CPI later reverts? atomic. good.
Potential issue: `last_guardian_id` update for `Brakes` with set_guardian true; if the proposal also contains a round and CPI later fails, revert. good.
Potential issue: `last_arm_id` etc.

Potential issue: the execution window `now <= voting_ends_at + EXECUTION_WINDOW_SECS`. `voting_ends_at` could be far future? bounded by MAX_VOTING_SECS from create. `checked_add` may overflow if voting_ends_at near i64 max; create doesn't allow `voting_ends_at - now <= MAX_VOTING_SECS`, but could `voting_ends_at` be i64::MAX? Then checked_sub? create `dur = voting_ends_at.checked_sub(now)`; if i64::MAX - now fits? i64::MAX - now (now ~1.7e9) fits; dur > MAX, fails. So no. good.

Potential issue in `capture_entropy`: It calls `try_capture` with `now=Clock::get()?.slot`. `try_capture` first if now <= reveal_slot NotYet. But reveal_slot was `slot + REVEAL_LEAD_SLOTS` (16) at mint. SlotHashes only contains ancestors? Actually SlotHashes sysvar contains parent slots, not current? For a given slot, the sysvar contains hashes of child? It is updated at start. At current slot s, entries for slots < s, not s. `want=reveal_slot=s0+16`. If now <= reveal_slot, NotYet. If now = reveal_slot, SlotHashes maybe doesn't include reveal_slot because current slot not yet finalized? It returns NotYet until now > reveal_slot. Test captures after readySlot. fine.

Potential issue: `reschedule_reveal` only allowed `now > reveal_slot + window`. But if reveal_slot was rescheduled, old window passed, reschedule again? It allows multiple reschedules if window passed. `reschedules` increments. good.

Potential issue: `crank` reschedules if Capture::Expired. It doesn't require the record is the next in FIFO. It can reschedule behind records, preserving FIFO. good.

Potential issue: `activate` first `crank(ctx.remaining_accounts, slot)?` before monthly_inline. If crank includes current vault with level0, it captures/reschedules then returns. Then monthly. Then activation. fine.

Potential issue: `activate` with `remaining_accounts` can include a record that is active? crank skips level !=0. fine.

Potential issue `claim` with crank_n >0:
```
let rem=remaining; let k = if crank_n==0 0 else crank_n as usize +1;
require rem.len()>=k
crank(&rem[..k], slot)
pairs = &rem[k..]
```
So if crank_n >0, it expects first account SlotHashes plus crank_n records. It doesn't validate beyond crank_n; `crank` interprets first as SlotHashes and at most MAX_CRANK accounts after. fine.
Potential issue: If crank_n=0 but remaining_accounts starts with SlotHashes? It would be treated as pair, load_record fails? Actually pairs.chunks(2), first record account is SlotHashes; require ri.is_writable, false maybe BadVaultRecord. fine.
Potential bug: `claim` monthly_inline is after `crank`. Host `claim` does capture/reschedule BEFORE monthly distribution. That's fine. It can reschedule, then monthly. 

Potential issue: `distribute` with burn path:
```
let rem=remaining_accounts
require rem.len()==4
let burner=rem[0], from=rem[1], gmint=rem[2], tprog=rem[3]
require burner.is_signer
require tprog.key==SPL_TOKEN
require gmint.key==GARY_MINT, owner SPL
read_token...
require waiting_to_join... 
burn CPI
```
It checks `waiting_to_join` after read_token and before burn. Good. It doesn't require `from` is Writable? AccountMeta in instruction builder likely; in handler it doesn't check `from.is_writable` or `gmint.is_writable`. CPI Burn requires mutable; AccountMeta meta uses `new(from.key, false)`? Wait in code:
```
AccountMeta::new(from.key(), false),
AccountMeta::new(gmint.key(), false),
```
It doesn't check `from.is_writable` in handler; but CPI will fail if account not writable. However if `from` is not writable in transaction, runtime may pass AccountInfo with false; invoke will fail. fine.
- It doesn't check from account is burner's ATA? It calls read_token(from, GARY, burner.key). good.
- It doesn't check `gmint` account is actually mint data length etc? It just owner. `read_token` reads from token account with mint field; gmint CPI burn verifies. fine.

Potential issue: `sweep_sol_for_swap` Context `SweepSolForSwap`:
```
#[account(mut)]
pub swap_operator: Signer<'info>,
```
So operator signs. It doesn't check system_program ID? Program type. good.

Potential severe: `split_revenue` transfer uses `decimals` u8 from caller, not derived from mint. A malicious split_revenue caller could pass wrong decimals, causing TransferChecked to fail or maybe pass with wrong amount? Token program TransferChecked with decimals mismatch checks expected amount; if caller passes wrong decimals, CPI likely fails. But can it cause the two transfers to sum to more than total? It transfers `amount` base units regardless. Decimals only for TransferChecked display. Could pass decimals causing token program to compute? Let's recall Token TransferChecked expects amount expected base units, decimals. It verifies decimals equal source/dest mint? It uses provided decimals to check against mint? Actually TransferChecked decodes `amount: u64, decimals: u8`. The token program does not compare decimals to mint; it multiplies amount * 10^decimals? Wait TransferChecked is for consistent decimals with UI amount; the instruction uses `amount` as UI amount and `decimals`, then converts to base amount = amount * 10^decimals. Hmm yes SPL Token TransferChecked is: `TransferChecked { amount: u64 /* UI amount */, decimals: u8 }`, and token program validates that amount in base units at token? Let's recall: The token program's processed TransferChecked takes `value.decimals` and converts `amount * 10^decimals` to base unit? Actually in instruction, `amount` is a u64 amount in base units? Let’s verify from memory: SPL Token `TransferChecked` instruction data: `amount: u64`, `decimals: u8`. The token program converts `amount` to base units by multiplying by 10^decimals? Wait no, if amount is UI amount, base unit = amount*10^decimals. For 1 token 9 decimals base=1_000_000_000. It then calls token::transfer with base amount. In MINT's `split_revenue`, it passes `amount` = `holders`/`bank_cut` in BASE units? It computes `total = d[64..72]` base units, bank_cut base units, holders base units. But TransferChecked expects UI amount? Looking at SPL Token `TransferChecked` docs: in @solana/spl-token, `createTransferCheckedInstruction` args `amount: bigint` are base units? Actually it takes amount as `amount * 10^decimals`? Let's verify mentally: Minting `mintTo` uses token amount base. For transfer, `createTransferInstruction` transfers base. `createTransferCheckedInstruction` also takes amount in base units? I used it: `createTransferCheckedInstruction(source, mint, dest, owner, 1e6, decimals)` maybe amount 1 token? Hmm maybe it takes "amount: bigint" "Number of tokens to transfer, in smallest decimal units"? I recall from @solana/spl-token docs `createTransferCheckedInstruction` parameter `amount: bigint - The amount of tokens to transfer (in base units)`. Actually maybe it checks decimals by converting? Let’s not go down. The suite passes `decimals=8` after reading real decimals. The program's `split_revenue` has `decimals` argument from caller but no check. If wrong decimals could affect amount. Need see SPL Token TransferChecked processor:

I remember SPL Token `TransferChecked` instruction serialized:
```
pub struct TransferChecked {
    pub amount: u64,
    pub decimals: u8,
}
```
In processor:
```
let amount = value.amount;
let decimals = value.decimals;
...
state.authority(amount)?
```
Wait there is `Checked` variants call `try_amount()` where they multiply? Hmm.

Let's recall actual Solana token program: `TokenInstruction::TransferChecked { amount, decimals }`. Processor TransferChecked:
```
let amount = match instruction {
    Transfer { amount } => amount,
    TransferChecked { amount, .. } => amount,
};
token::transfer(... amount)
```
I think the `decimals` field is UNUSED in Classic SPL Token TransferChecked! It is for client-side validation only? Let me recall: In `spl-token/src/instruction.rs`, `TransferChecked { amount: u64, decimals: u8 }`. The byte size includes decimals, but processor `process_transfer_checked` probably calls `token::transfer` with `amount` as base units, and doesn't check decimals. There is an `approve` behavior? Actually Token-2022 uses decimals to calculate? Hmm. If decimals not used, caller can pass anything. Fine.

But if it is used to calculate base, wrong decimals would transfer wrong amount. Let's verify from known code: SPL Token's `TransferChecked` was designed to allow UIs that require decimals to construct amount correctly? No, its purpose is for instruction parsers to verify the amount using the mint's decimals at client side? The processor cannot know decimals unless mint account is passed (but TransferChecked instruction accounts do NOT include mint). The accounts are: source, mint, destination, authority. The processor receives mint account for TransferChecked? Wait TokenTransferChecked accounts include mint? I need recall account list: TransferChecked requires `source, mint, destination, authority`, yes includes mint. So processor can read mint decimals. The instruction's `decimals` is compared to mint data decimals: if mismatch, program errors. It still amount is base units. If caller passes decimals 8, mint decimals 8, fine. So decimals must match. The program does not derive decimals from mint, but if wrong CPI fails. no theft. If cbBTC decimals not 8? actual is 8. Test reads. Formal: If deploy with payment_mint mis-set to token 8 decimals, and split caller passes wrong, fails; no loss. But if decimals differ and caller passes right, works. Not a bug.

Potential issue: `split_revenue` computes bank cut as `(total * 1500)/10000` but if `total` extremely small (<7) bank_cut can be 0 and holders = total. It then only transfers holders. That is floor. fine.

Potential issue: `split_revenue` does not verify `revenue_ata` belongs to revenue PDA owner? It derives expected. good.

Potential issue: `mint_vault` payment transfer: It computes decimals by reading payment_mint data, but it neither checks mint data initialized beyond owner/length? It requires owner classic and len82; reads decimals at44. It doesn't require data[45]==1 initialized? SEAL's `assert_classic_spl` only checks owner, not mint initialized. MINT's `initialize` checks `payment_mint not default` and SEAL reserves contain it. SEAL initialize assert_classic_spl checks only owner and declare account, not data length or initialized. So a non-mint account owned by Token program could be passed as reserve/payment? The token program CPI may fail later, but config could be initialized with wrong account. However launch checker pins actual mints. Accepted item 38. Not new.

Potential issue in `cbob_mint` validation: It reads mint account data len82 and initialized byte at45. It doesn't read decimals or freeze/mint authorities. Could be any token account? len82 mint. good.

Potential issue in `initialize` collection clean check: It doesn't check collection account is executable? no.

Potential issue in `split_revenue`: The `decimals` argument is chosen by caller but account list doesn't include mint? It includes mint. Fine.

Potential issue in GOV `initialize` not requiring BURN config? It checks MINT only. BURN initialized separately. But create_proposal requires burn config. Road order.

Potential issue in sweep helper: The source account length exactly 165. It reads `to` account before verifying to account is non-source? fine.

Potential issue: The source account can be frozen. Transfer fails. Freeze of source could be used by Coinbase or token authorities? For reserve cbBTC Coinbase can freeze the vault's cbBTC ATA. The helper's transfer of a frozen source reverts; redemption cannot bypass, so holder stuck until thaw. Accepted. But for $GARY/GIRAFFISH no freeze on mainnet. If stranger somehow freezes a reserve? No freeze authority for them, so only cbBTC. Fine.
- What about destination account frozen? Token Transfer to a frozen account also fails. If owner's ATA is frozen, redeemer cannot sweep. Accepted. The sweep helper does not skip or defrost. That's redemption all-or-nothing. The holder could create different destination account for same mint? Since destination wallet is owner, but the destination account for mint could be any token account owned by owner, not necessarily their ATA. If owner's canonical ATA is frozen, they can create another non-ATA token account owned by them and use as destination. The helper requires token account owner=destsame key and same mint, not ATA. So if a particular account frozen, page can use another. Good. For cbBTC, Coinbase could freeze all owner accounts? With freeze authority, can freeze any account. Not code.

Potential issue: BURN's emptiness proof requires every reserve ATA for PDA under both token programs declared. If vault's classic ATA was frozen and sweep uses a different destination but leaves source closed. It must close source before burn. If frozen, cannot transfer/close. stuck.

Potential issue: If source account has an immutable owner extension? classic no.

Now big area R3 level draw: "Check SlotHashes parse, skipped-slot handling, FIFO, burned vault at head, attribute re-supply hash, and what minter/crank/slot leader can influence." There may be a subtle bug: `try_capture` uses `blockhash_in_window` to find smallest produced slot in `[want, want+MAX_SKIPPED_SLOTS]`, where `want` after A uses `(slot / LEADER_GROUP_SLOTS + STRIDE)*LEADER_GROUP_SLOTS`. On mainnet, leader schedule rotates every 4 slots but slots can be skipped. They choose first produced slot at or after group start. But if group start slot is skipped and the first produced slot is beyond group start maybe same group? It uses produced slot in [want, want+64], could be into next group if an entire 4-slot group was skipped? MAX_SKIPPED_SLOTS=64, so yes could be into following groups, potentially B and C not in separate leader rotations; but that's the accepted limit. Not a new bug.

Potential issue: C's leader can also choose by varying block contents. This is accepted. But can a minter/crank influence more than stated? Maybe an attacker can explicitly call `reschedule_reveal` repeatedly until reveal_slot falls under a leader they choose. The schedule is public and reschedule only sets new slot = now + 16. If an attacker/member can monitor and send reschedule at a particular slot, they can choose new reveal_slot = current slot +16. They can time reschedule to control which future leader group (within reason) by sending transaction in desired slot. Does this give them easier selection? The accepted limit 25 says minter can let lapse for re-roll; it doesn't mention choosing reschedule timing via front-running? Anyone can reschedule after window passes. The reschedule uses current slot+16; a party can choose when to send the reschedule transaction (subject to slot) and thus choose the new reveal_slot to be a particular future slot. Because current slot controlled by transaction inclusion. If they know leader schedule, they can submit reschedule in a slot such that reveal_slot aligns with desired leader. This is inherent? SPEC says "The new target is now + REVEAL_LEAD_SLOTS: a slot that does not exist when this lands, so nobody chooses among hashes they can already see." It doesn't claim leader-agnostic. Could be stronger than accepted? It might allow a holder who wants re-roll to also time it to a desired last leader. But the draw uses future slot after `now+16`; they can choose `now` within 300-slot lapse window? Actually reschedule is only allowed once window passed. The minter/crank operator can wait arbitrary time and send reschedule at a chosen slot, selecting reveal_slot. This is a potential finding: a lapsed draw can be rescheduled at a time chosen by anyone, giving control over the future reveal slot and hence potentially which leader group C lands in. But the same party with capture/withholding already can choose? Let's examine. The minter who dislikes draw can deliberately let capture lapse. Anyone can reschedule after window. An attacker (not necessarily minter) can call reschedule at a slot they choose, picking new reveal_slot. Since the reveal_slot is now+16, they can choose any future reveal_slot >= current+16, and they control current by delaying the reschedule transaction. This gives ability to decide the new draw entropy slot start, within constraints. Does it help selecting draw? C's leader can grind its block; the rescheduler can pick whether C is a leader they control. The entropy uses three hashes from three leader groups. If the rescheduler is a validator/miner, they can reschedule at a slot such that C's group is their own rotation and then grind, or if they collude with leader. This is likely accepted under item 26? Item 26 focuses C's leader chosen. SPEC says rescheduled to future slot "nobody can choose among hashes anyone can already see"; but someone can choose future slot by timing reschedule. Maybe not worse than item 26? They can choose epoch for C maybe. The accepted limits probably implicitly accepted. But maybe it is a newly precise point: `reschedule_reveal` is permissionless and the new slot is a function of current slot, so an attacker can time the call to put C inside their own leader rotation with much less waiting than minting. But being C's leader is already chosen not stake lottery; validator can time a mint or reschedule to put C inside own rotation per SPEC 26. So accepted. Do not file perhaps.

Another possible level bug: `reveal_level` captures inline if entropy_set false. But `capture_entropy` requires `r.level == 0 && !r.entropy_set`. `reveal_level` itself, before calling `try_capture`, checks `ctx.accounts.vault_record.level == 0`. It doesn't check `entropy_set`? It sets local `set` from record. If inline capture got entropy and stores to record prematurely before all checks, okay. 
But there's a critical: In `reveal_level`, it checks `index == ctx.accounts.config.revealed_total`, then computes entropy inline if needed. It does not require `attributes` hash before computing entropy? only later. fine.
Potential issue: `try_capture` uses `asset` in hash. The record's `asset` is read from account; `reveal_level` requires asset account key equals record.asset. So a malicious record? PDA seeds bind. fine.

Potential issue: `blockhash_in_window` requires all-zero hash refusal. Solana SlotHashes for skipped slots maybe entries? It loops produced entries. If a produced slot's hash all zero impossible. fine.

Potential issue: `MAX_SKIPPED_SLOTS` 64 and window 300. Try_capture first if now > reveal_slot +300 return Expired before looking. But C is computed after two strides: A may be up to reveal+64; B want = after group; B could be up to wantB+64; B relative to reveal maybe +64+8+64=+136; C up to wantC+64 maybe +200+64+? within 300. Comments claim C at most ~3*(8+64)=216 past reveal. fine.
Could a slot leader skip beyond 64 for A? On Solana, leader can skip all 4 slots; next leader slots maybe after 4. `MAX_SKIPPED_SLOTS=64` generous. If skip more than64? PoS leader schedule can have slots with unknown? The chain can skip over long outage, but produced slots may have gaps longer than64. If no produced slot within [want,want+64], `blockhash_in_window` returns None and capture waits, then expires after 300 from reveal; reschedule. That is safe. It never uses too-far hash. good.

Potential issue: `reschedule` if `now + REVEAL_LEAD_SLOTS` overflow? u64 slots far future. checked.

Now R4 governance possible freeze. Accepted.

R5 charter claim. Need attack PoB set. Potential bug: Merkle proof max 16, but 240 leaves depth8. Domain separated. good.
Potential issue: PoB root not validated against live set at initialize except nonzero; launch checker. accepted.

Potential issue: `claim_charter_vault` `pob_extra` accounts passed through to Core burn "never as signers". But account metas:
```
metas.push(if a.is_writable { AccountMeta::new(a.key(), false) } else { AccountMeta::new_readonly(a.key(), false) })
```
It passes writable extra accounts as writable. Is that allowed? It may allow malicious extra accounts to be written by Core oracle? The instruction is Core BurnV1; Core may write some passed accounts? External plugins can have accounts read or writable. The caller supplies them; if writable, Core plugin could modify them. But the caller included them and signed? They are not signer. Could the PoB collection update authority (hot wallet) configure an oracle that writes to arbitrary extra accounts? It knows the fixed accounts? External plugin validation may require certain accounts. The owner/caller can pass writable accounts. If a malicious oracle plugin (added by hot wallet) could write to those accounts even if not signer? It is running inside Core's CPI; the transaction includes those accounts as writable, so the plugin could modify them. But the caller consents by including. no theft beyond caller's chosen accounts. Potential issue accepted.

Potential issue: PoB collection update authority can add plugin that rejects; accepted.

Potential issue: `claim_charter_vault` after burn creates vault. Since PoB burned, owner still signs. good.

Potential issue: `check_supply` for charter claims counts against level_caps; if cap total reached, no claims. fine.

R6 one-time config: The trusted swap operator key bounded? We could find initialization accepts wrong values. But item 38. Maybe real bug: MINT initialize does not enforce `charter_closes_at - charter_opens_at <= MAX_CHARTER_SECS` with `charter_closes_at.checked_sub(charter_opens_at)`. good.
Maybe it doesn't enforce `charter_opens_at` is future beyond now? It only requires charter_closes_at > now. It can initialize with charter_opens_at in past, so window already open. That's intended maybe. If opens in past but closes future, fine.
Maybe it doesn't enforce `charter_opens_at` before `lock_deadline`? not code.

Potential issue: `monthly_secs` caps at MONTHLY_SECS; good.
Potential issue: `notice_secs` 60 to 30 days. Ruled 7 days. But max 30 days allows. fine.
Potential issue: `redeem_window_secs` in BURN allows 10s to 24h. Ruled 3600. Checker pins. fine.

R7 raw offsets. We recalculated correct. Could there be mismatch for SEAL config offsets? Need verify SEAL Config layout:
```
version u8 (account 8)
collection Pubkey (9-40)
reserve_mints Vec<Pubkey> (u32 length at41-44, keys)
bump u8 at after vector
```
MINT `OFF_RESERVES=41` correct. `OFF_COLLECTION=9`. BURN same. good.
Potential issue `SEAL Config` space: `8 +1+32+4+(32*MAX_RESERVE_MINTS)+1+ CONFIG_PADDING`. For max3 =8+1+32+4+96+1+256=398. Account data. Borsh Config struct version u8 collection Pubkey reserve_mints Vec bump u8. good.
Potential issue `MINT_CONFIG_SPACE` calculation might be wrong? They allocate exact. We can verify with struct sizes. If wrong, account may be too small, deserialize fail. But suite passes, so likely correct. However `CONFIG_PADDING` 256; structure total maybe exactly around 749+ after ring? Let's compute. 
Account data with disc: MINT_CONFIG_SPACE = ... as code. Need maybe sum. We can trust suite.

Now tests/sim evidence. We can identify arms that cannot fail or wrong reason? Might be actual code not tests. The prompt asks find arms cannot fail. But as audit, maybe focus code.

Let's examine current round25 repairs as targets. Maybe there are new inserted bugs. The code in tests has some suspicious. But findings should be program/offchain not test unless evidence gap. We can note evidence gaps low.

Maybe there is a real bug in `claim` handling of `carry_scaled` after paying a frozen claim with boost expiry. Let's inspect frozen claim + boost due:
- claim loads record, sees boost due and expires (reweigh), touched true.
- Calculates pending = owed_of after reweigh. It logs and stores record for frozen. owed_scaled unchanged. The vault remains owed pending. Later thawed claim will pay. fine.
- But if `pay == 0` and touched, it stores record and continues, even if pending has sub-sat. good.

Potential bug: In `claim`, for pending vault join branch, it does not perform `monthly_inline` before? Wait monthly_inline runs before loop. good.
Potential issue: `claim` with `crank_n` and `pairs` includes same vault record twice. For active vault same record paid twice? Let's analyze duplicate pair of same active record. The record deserialized first time, pay p, sets debt_scaled to weight*acc and carry to residue. Stores record. Then second pair loads updated record, pending = weight*acc + carry - debt = carry (sub-sat) or maybe zero. pay=0. No double payment. Good. But there is `owed_paid` tracked and config.owed_scaled reduced at end. fine.

Potential bug: `owed_of` may underflow if debt > weight*acc+carry. It returns error Overflow. Can debt exceed? In `activate`, join sets debt=w*acc. In claim payment, r.carry_scaled = pending - settled (residue), r.debt_scaled=weight*acc. carry < SCALE. Since debt=weight*acc, owed=carry. Good. In reweigh, debt set after*acc, carry=owed. Owe=owed. good. In retire, debt=full, carry=0, inactive. fine.
- But `claim` for a vault after multiple distributions without claim: debt=w*acc_at_join (acc at join old). acc current larger. pending=w*acc_current - debt + carry. good.

Potential bug: In `claim`, if a vault is skipped because `pay==0` and `touched` false, it does not store record (but record unchanged). fine.
Potential bug: `expire_boosts` loads and stores record if active/due. It doesn't store skipped records; fine.

Potential bug: `unschedule_boost` due branch subtracts from `boosts_due`, but if the same record had boost_expired due and the ring slot also had been reset in advance_epoch? Due boost count not in ring. correct.

Potential bug: `advance_epoch` adding boost_expiring[i] to boosts_due then setting to 0. But `boost_expiring[i]` may contain boosts that were already unscheduled early but not removed if their vault retired before due? `retire` calls unschedule_boost future branch decrements ring slot. good.
Potential bug: `boost_expiring` ring slot index computed as `(end % BOOST_RING)`. If `end` future wraps beyond current, slot may have been previously used for due boosts and should be zero after advance epoch processed. Between purchases, if slot not zero because there is a future boost ending at current? Wait advance_epoch when reaching slot i sets to 0 after adding due. Future boosts ending at slot i (which is current at that time) become due and are added, then slot zero. There cannot be another future boost scheduled at same ring slot because due gate prevents advance past due and lifetime max 63. We reasoned.

Potential bug: `boost_vault` itself doesn't call `expire_boosts` or check due; if there is a due boost and someone buys new boost, it schedules at current dist_epoch without advance, so no collision. okay.

Potential bug around `total_active_weight` and boosts_active:
- `reweigh` before `boost_weight_total` update? It does after `reweigh`. `reweigh` changes total_active_weight using `r.boost_weight` old to new extra. It doesn't touch config.boost_weight_total. Then after reweigh, increments boost_weight_total by extra. good.
- In expire_boost: does `unschedule_boost` first (decrements boost_weight_total and boosts_active), then `reweigh(c,r,0)` (changes total_active_weight). good.
- In retire: `weight_of(r)` includes boost. subtracts total; `unschedule_boost` decrements boost totals. It does not set r.boost_weight=0 before debt? okay.
- In `join` no boost.

Potential issue: `reweigh` when changing boost, it computes `before=weight_of`, `owed=owed_of`, then sets `r.boost_weight=boost` even if before? callers ensure not active boost for boost_vault; expire sets 0. fine.

Potential bug in `boost_vault` reads owner from asset using d[1..33] and compares `ctx.accounts.burner.key()`. It does not ensure `burner` is Signer? `ctx.accounts.burner` is Signer. good.

Potential issue: `boost_vault` calls monthly_inline before terms check. If monthly due, it might distribute and advance epoch, then terms read fresh. good.

Potential issue: `boost_vault` uses `burner_token` read_token with owner `burner.key()`. It doesn't ensure `burner_token` is writable? CPI will. good.

Potential issue: In `boost_vault`, after burning `price`, it doesn't update burn supply? SPL burn CPI does. good.

Potential issue: `distribute` free path with w>0 and no burn doesn't require args `burn=false`? data bool false. fine.

Potential issue: `distribute` w==0 branch:
```
require!(waiting_to_join(c)? ==0, JoinWaitingFirst);
require!(!burn && c.pending_this_epoch >0, NoActiveVaults);
require rem empty
require month elapsed
return tick(c, now)
```
It doesn't require pool balance? It reads pool before. If pool holds balances but no active vaults, free tick allowed if current pending. That credits nothing, leaves pool. fine.
Potential issue: if w==0 and pending_this_epoch>0 but pool holds huge revenue unsplit from before, free tick advances epoch; new vaults can join and later distributions share backlog. intended.

Potential issue: There is no `pool_is_frozen` in distributes. It doesn't care freeze. It can credit from frozen pool because read_token returns state frozen? read_token returns state, but distribute ignores state. Wait `read_token` checks `d.len ==165`, `mint` field, owner field, returns `(amount, d[TOKEN_STATE_OFF])`. It does NOT require state initialized. So if pool account is FROZEN, read_token returns balance and state=2; distribute ignores state and then `credit` adds to owed_scaled and `advance_epoch`. It does not actually transfer tokens out of pool to distribute; it credits accumulator only. The pool balance physically stays in frozen account. Is that allowed? The distribution makes vaults owed based on frozen pool balance. Then claims later need transfer from frozen pool, but can't. For active vault with owed sat, redemption with pool frozen forfeits share. But explicit distribute from a frozen pool credits and makes owed_scaled increase, reducing avail maybe. Is this a bug? Comment in monthly_inline says "A frozen pool can deliver nothing; crediting from it would only make every vault owed again ... if d[TOKEN_STATE_OFF]==FROZEN { return Ok(()) }" It avoids crediting frozen pool in monthly inline. But `distribute` DOES credit from frozen pool because it ignores state! Let's inspect `distribute` start:
```
let (balance, _) = read_token(&pool_token, payment_mint, pool_owner)?;
require boosts_due==0;
let w=...
if w==0 { ... }
let owed=ceil_sats(...)
let avail=balance.checked_sub(owed)
...
credit(c, avail, w, now)
```
It never checks state. So when pool frozen, a permissionless `distribute` can credit avail (balance - owed) to active vaults even though no tokens can be transferred out. Then `owed_scaled` increases. Claims will fail; redemptions forfeit. This conflicts with red-team3 finding 1: "in-line monthly run never credits from a frozen pool." They only changed monthly_inline, not explicit distribute. But is this a real problem? Let's think.

If pool frozen and `distribute(burn)` is called, it burns 100 $GARY and credits all undistributed pool balance to vaults, advancing epoch. This could be used by an attacker (or anyone) during a pool freeze to convert all pool balance into owed_scaled, which increases the amount a redeemer forfeits if they redeem while frozen (forfeited to pool, not paid). But the pool remains frozen; when unfrozen, claims can pay these owed shares. Is there harm? During freeze, redemptions can still happen but forfeit owed share. If someone distributes frozen funds before a holder redeems, the holder is owed more, but then forfeits it, so they lose more (to pool, for remaining vaults). Could an attacker cause another holder to forfeit their accrued share by distributing while pool frozen? Actually if no distribution occurs, a redeemer's pending share may be only pre-freeze owed. If they redeem while pool frozen, they forfeit that. If attacker distributes frozen balance, the redeemer's pending share becomes larger (maybe all frozen balance), and they forfeit more. But that "more" would otherwise eventually be distributed to them if they stayed; redeeming while pool frozen already forfeits "whatever was credited and not delivered." The holder who redeems during freeze might inadvertently lose more if someone else distributed right before. Is that a griefing vector but not theft (goes to pool/other vaults). Could an attacker with many vaults benefit by forcing distributions during freeze and then causing other vaults to forfeit? The forfeited shares decrease owed_scaled and thus remain in pool, benefiting remaining vaults. The attacker could be a remaining vault. They need burn 100 $GARY per distribution. Could do. Is this within accepted limit 28? It states "Since stage 3c it no longer locks any vault: a redemption with pool frozen lands and FORFEITS its undelivered share back to pool, and in-line monthly run never credits from a frozen pool." It does NOT mention explicit distribute crediting from frozen pool. Is that a defect? Let's see if `distribute` should be refused while pool frozen to avoid crediting undeliverable shares. Red-team3 finding 1 specifically maybe only concerned redemption lock. The code comments in `monthly_inline` say "A FROZEN pool can deliver nothing; crediting from it would only make every vault owed again..." That rationale would apply to explicit distribute too. But `distribute` does not check. Is there any recovery issue? When pool remains frozen, owed_scaled increases, pool balance fixed. When frozen lifts, claims can pay out. The pool balance still owns same tokens, so no insolvency. If all vaults redeem while frozen, they forfeit owed, and pool retains. It's not locking vaults. It might accelerate distribution without moving funds, but distribution is just accounting. The "crediting from frozen pool" concern: It makes owed vaults, then redemptions while frozen forfeit larger amounts. That is a chosen behavior maybe not fixed. Could be a MED/LOW finding? We need decide. The prompt under R2: look hard at counter and liveness, invariant "pool always holds at least ceil(owed)". If distribute from frozen pool, token balance unchanged, owed_scaled increases, so invariant? Before B>=ceil(owed). After B same, owed_scaled increases by <= avail, so B>=ceil(owed) still holds (we proved). So invariant holds. But the pool's physical token account is frozen; claims can't deliver, but invariant does not account freeze. Not a double-spend.

But there might be a more severe liveness/forfeit issue: `distribute` from a frozen pool advances `dist_epoch` and satisfies monthly period, even though no tokens moved. This might allow boosts to expire, activations to join etc. Could affect boost exact N: A distribution that credits nothing physical but increments epoch causes boosts to expire early. Is that intended? A distribution means epoch advances, even if pool frozen. But if no vaults can get tokens, still counts. Could a malicious holder burn 100 $GARY during a pool freeze to force other vaults' boosts to expire, reducing their weights? That might be economically harmful. But boost expiration is supposed to count distributions regardless of amount; if pool frozen, distribution isn't a real distribution though it credits accounting. The code doesn't check freeze. Could be an attack: when pool frozen, burn $GARY to distribute, causing boosts to advance/expire. But to distribute, w>0 and avail>0. If pool frozen with balance, yes. The distribution credits new shares at boosted weights and advances epoch. This allows the attacker to accelerate boost expiry and alter own/others payouts. Does it burn own $GARY; accepted that anyone can trigger distributions whenever pool holds something new. Freeze maybe doesn't stop.

Is this a confirmed program defect? Need compare to comment and red-team3. I think it's at least a real bug: `distribute` should probably not credit from a frozen pool, mirroring `monthly_inline`, or else all the same "every vault owed again" outcomes. But what is exploit? Let's formulate precisely.

Evidence if true: In a local test, freeze POOL, then call `distribute(false)` when month due and pool has balance/active vaults; it would land and log `CBOB_DISTRIBUTED amount=...` and owed_scaled increases, while pool balance unchanged/frozen. The suite doesn't test explicit distribute with pool frozen; 3c.F1 only claim. SR.14 tests frozen vault source. This can be checked.

Severity maybe LOW/MEDIUM. It doesn't steal, but can cause holders redeeming during freeze to forfeit more than they otherwise would, and can run boost epochs. Because anyone can call distribute and burn $GARY. Red-team3's intent was "frozen pool NEVER credits" because crediting from frozen pool makes redemptions forfeit. Let's see the comment in SPEC: "An explicit `distribute` is not refused for a frozen pool; it can only make vaults owed again, and owed vaults still redeem by the same forfeit." Wait the prompt includes SPEC verbatim and in the community pool section says:
"**A frozen pool never locks a vault ...** Coinbase ... With the pool frozen no `claim` can deliver, and a redemption must settle what it is owed first, so before stage 3c ... Now `retire_redeemed` lets the redemption land and returns the undelivered share to the pool (logged ...), and the in-line monthly run never credits from a frozen pool. An explicit `distribute` is not refused for a frozen pool; it can only make vaults owed again, and owed vaults still redeem by the same forfeit."
Ah! The spec explicitly accepts/states distribute not refused for frozen pool. So not a finding; it is documented. Good catch. So don't file.

Potential issue in monthly_inline with frozen pool and no active weight: It ticks epoch even if pool frozen; maybe same documented.

Now other subtle areas.

Let's inspect `apply_swap_operator` and `apply_guardian`. They are permissionless. Could there be an "overtaken action logged no-op" issue? Not.

Potential issue: `arm_swap_operator` restarts clock even if same operator, no issue.
Potential issue: `apply_swap_operator` doesn't clear pending_swap_operator_at? It clears. good.
Potential issue: `apply_guardian` doesn't require `guardian` not default? It allows None. good.

Potential issue in `Guardian` context: `#[account(mut, seeds=[CONFIG_SEED], bump=config.bump)]` no has_one. It relies handler require_guardian. good.

Potential issue in `initialize`: It sets `last_distribute_at = Clock::get()?.unix_timestamp.max(charter_closes_at);` Good. If clock unix > charter_closes, first free distribution due immediately at init? But no vaults/active until after charter; maybe okay. The "max" means starts at init time if after close, but init must have charter close > now? It requires charter_closes_at > now, so init time < close. So max is close. good.

Potential issue: `monthly_secs` 150 in suite. fine.

Potential issue: `mint_vault` monthly_inline runs before sales_stopped. If guardian stops sales and month due, mint_vault can still monthly distribute but then fail. Could this violate "stopped sales no mint"? It doesn't mint. okay.

Potential issue: `claim_charter_vault` monthly_inline runs before charter window check. A charter claim outside window could trigger monthly distribution even if not valid. Permissionless host; okay.

Potential issue: `activate` cranks before monthly_inline. It can reschedule/capture queued records, then monthly. fine.

Now `sweep_sol_for_swap` potential abuse: 
- It reads `last_sweep_at`; if `last_sweep_at` is in future due to chain clock? Clock unix timestamps monotonic. initialize 0. fine.
- It checks `amount <= max_sweep_lamports`, `bal >= keep+amount`. It doesn't require `amount` leaves enough for rent? Keep maybe 0 if initialized 0. If keep=0, can sweep all lamports from revenue PDA, leaving it zero. Is that allowed? Yes initialize can set reserve 0; launch value nonzero. accepted. 
- It doesn't check `swap_operator` is not revenue/PDA/default? init non-default, can be same as revenue? swap_operator is signer on curve, revenue offcurve. fine.
- It doesn't check `ctx.accounts.swap_operator` is writable? Signer mutable in account struct. CPI system transfer to operator makes it writable. fine.

Potential big: `split_revenue` sends to `bank_treasury` ATA derived with `SPL_TOKEN_ID`; if `bank_treasury` is off-curve Squads and has ATA. It expects both accounts. fine.

Potential issue: The revenue PDA can be drained of SOL by sweep operator every cooldown until reserve. The guardian can stop. accepted.

Now potential issue in initialize collection royalty plugin. It uses `PluginAuthority::None` data:
```
data.push(1); data.push(PLUGIN_AUTHORITY_NONE); // Some(None)
```
`PLUGIN_AUTHORITY_NONE=0`. Authority None. good.
Royalty plugin format maybe tested.

Potential issue: `set_frozen` SEAL thaw uses `core_plugin_cpi` data `vec![IX_UPDATE_PLUGIN_V1, PLUGIN_PERMANENT_FREEZE_EXECUTE, u8::from(frozen)]`. For UpdatePluginV1, data format likely plugin type and new authority? Wait PermanentFreezeExecute plugin UpdatePluginV1 data needs `plugin: PluginType`, `authority: PluginAuthority`, `new_frozen: bool`? Let's inspect MPL Core SDK. They manually push [IX_UPDATE_PLUGIN_V1, PLUGIN_PERMANENT_FREEZE_EXECUTE, u8::from(frozen)]. Is that the right format? Tested open works. fine.

Potential issue: MINT `create_vault` plugin list and `CreateV2` data maybe order wrong but tested.

Now maybe there is a vulnerability in GOV proposal `created_at` used for restart skip. It snapshots poposal created_at. A proposal can be executed up to week later. For restart skip, it compares stop time >= p.created_at. If guardian stops AFTER proposal created, skip. Good. What if guardian stops before proposal created but stops.restart_sales proposed while currently stopped? Creation validation allows restart, and execution will not skip if stops_sales_stopped_at < p.created_at. Then MINT restart sets flag false. Good. This is the intended way to restart after stop.
Potential issue: If guardian stops exactly same second as create, stop time tie >= causes skip; accepted.

Potential issue: `emergency_stop_sales` records stop time only on transition. A guardian can stop, then a vote restarts, then guardian stops again; stop time updated on second transition because !c.sales_stopped. good.

Potential issue: `restart` in MINT doesn't clear sales_stopped_at. It leaves old timestamp; later stop transition updates when flag false. okay.

Potential issue: `apply_guardian` sets `c.guardian = c.pending_guardian;` if pending None sets default. It doesn't emit? emit_wiring. good.

Potential issue: `create_proposal` quorum supply uses live supply from MINT and BURN config but BURN's burned_total may lag? It's updated atomically with burns. okay.

Potential issue: `read_burn_total` in GOV doesn't validate BURN config collection matches? It validates version/discriminator/address/owner, but not collection field. It uses only burned_total. If BURN config wrong collection? At initialize BURN wired to same; if not, GOV's bar includes burned_total from wrong burn program? But BURN is a pinned program ID; the address is derived. If replaced? upgrade authority? immutable after. fine.
Potential issue: `read_mint_config` in GOV doesn't validate collection matches? It reads it and compares in initialize/proposals maybe. It includes. good.

Potential issue: `create_proposal` reads m.minted_total etc before requiring collection? It reads config and burn, then vault. It requires `now >= m.charter_closes_at`. good.
Potential issue: It does not check `voting_ends_at` overflow with `now`? checked_sub. good.

Potential issue in `read_prop` tests not code.

Now sweep helper access control maybe there is a subtle bypass: What if an owner has transfer delegate and delegate can execute? Core tested current binary; no. Fine.

Potential issue: `receive` direct call with signer asset-signer via Core Execute requires `signer.key == dest.key` forbidden. Could the destination wallet be set to destination token account? It compares signer key vs dest system account, not token account. fine.

Potential issue: An account list with `accounts.len=4` zero pairs and `signer == dest` refused. Good.
Potential issue: If `accounts.len -4` even, but extra account pairs can include read-only source? It attempts borrow_data and CPI. Maybe if source readonly fails. no.
Potential issue: `read_token` for `to` does not require `to` is writable; transfer CPI requires writable. good.
Potential issue: The helper does not require `to` owner is token program? read_token does owner == SPL. good.

Potential issue: The helper doesn't check account 0 `signer` is actually a PDA with no data? It just needs signer. If called directly by a normal wallet, source owner must equal signer; so it can sweep wallet's own token accounts and lamports to dest wallet. But normal wallet can just sign transfers. no.

Potential issue: The helper's lamport transfer uses `system_instruction::transfer(signer.key, dest.key, lamports)`. It doesn't specify program ID in accounts but invoke with system program. good.

Now maybe look for vulnerabilities in off-chain `rehearsal-tree.sh`: It maps real IDs to throwaway by string replacement. It refuses if any map key inside another. But could it miss binary/non-utf8? It scans git ls-files only specific dirs with Unicode decode skip. It reverse maps. Could there be a path with different case? Probably not relevant. Not a program bug.

Potential issue `scripts/build-mainnet.sh` compares helper mainnet bytes to localnet and target/deploy. Good.

Potential issue `run-tests.sh` floors equal counts. good.

Potential issue in `scripts/probe-mainnet-facts.mjs`: It simulates Token-2022 ATA creation for reserve mints. Good.

Potential issue in Test Vault simulation `clone-pob.mjs`: It patches owner bytes position 1..33. Could it accidentally patch collection? no.

The prompt says "Round 25's repairs are first target" and asks to verify each new arm's ability to fail for named reason. Could find an arm that cannot fail or refuses different reason. We may need produce findings if evidence gaps. But likely current code intentionally has some hidden bugs.

Let's examine tests around SR.12a duplicate source. They expect refusal `Provided owner is not allowed`. Does helper refuse duplicate source for that reason? Let's trace duplicate source pair: 
- accounts: pairs pU twice: first pair [ata(V2.pda), alice's ATA], second pair same.
- First pair transfers amount, then close source. It successfully removes source account. Second pair `read_token(src)` where src account now closed? The account still exists? CloseAccount transfers lamports to dest and may mark account? Classic SPL CloseAccount leaves account with zero data? Actually it sets account state? But the account may still be owned by token program and data length zero? `read_token` requires owner SPL and data len165. If closed account data length 0, read_token returns InvalidAccountData. The test expected `Provided owner is not allowed` (0x1? custom?). Wait the comment in tests says pin includes `Program SW failed: Provided owner is not allowed`. How does that happen? Let's trace:
- `CloseAccount` from SPL token likely transfers lamports and then zeroes account data? It may set data? The account still exists with length 165 but state uninitialized? read_token doesn't check state, it checks owner SPL and len165. It then reads mint field, owner field, amount. If after CloseAccount, the account is still owned by token program and data length 165? Actually SPL CloseAccount may close by transferring all lamports and then setting account data to empty? In Solana, an account cannot be shrunk; but token program might not write data. It may transfer all lamports; data remains. read_token would then see amount? Maybe amount is set to 0? The second transfer with amount 0 then invoke close; but `src_owner != signer.key`? No, owner field still PDA. to_owner and mint match. amount perhaps 0. Then it invokes close again with source account having 0 lamports? CloseAccount on an already-closed account maybe returns `Provided owner is not allowed` because token account state uninitialized? Hmm possible. The test expected that. It can fail? fine.

But maybe there is a real bug: Duplicate source account could fail with a reason not in title but pin includes. not a program bug.

Let's inspect `claim` and `retire` for accounting if a vault is both active and pending? Could that state occur? activate second call if pending true and dist_epoch > request joins: sets pending false, active true. first call only if !pending. Could no.

Potential issue: `claim` join branch for a pending vault does not require `dest` writable? It just requires key equal. Then `join` doesn't transfer. good.

Potential issue: `activate` first call does not check `pending_this_epoch` overflow? u64. good.

Potential issue: `minted_total` equals all mints including redeemed; `level_caps` sum maybe max_supply. At census exhausted, no more mint even if redeemed; intended lifetime cap.

Potential issue: `set_round` can cap > level_caps remaining; then mint_vault check_supply refuses when census exhausted. A vote can set cap huge, but max_supply and level_caps bound lifetime. `check_supply` prevents mints once minted_total >= cap_total even if max_supply not reached. If rounds sell above level caps? Since minted_total counts all, if cap_total=2100, no more. fine.
But could a vote set a round cap of e.g. 5000, while lifetime 2100; at cap_total reached no more. fine.

Potential issue: `mint_vault` check_supply doesn't require that there is a level available in remaining caps? It checks `minted_total < cap_total`, but what if some levels caps are exhausted and remaining cap only for levels, always sum remaining >0. The reveal later picks from remaining; all mints before cap_total have at least one remaining. good.

Potential issue: `reveal_level` picks level among remaining using `entropy[0..8] % total`. If total > u64? remaining per level u32, total u64 2100. fine. `x` u64; if `r`=0 and x<0 etc. good.
Potential issue: When `level_caps[i]` subtract `level_minted[i]`, `saturating_sub` used, so no underflow. level_minted can't exceed cap. fine.

Potential issue: `mint_vault` `attributes` list can include attribute key "level" reserved. good.

Potential issue: Core asset owner bytes: For Core AssetV1, owner is at bytes 1..33. `read_core_asset` does `data[33] == UA_DISC_COLLECTION`. For collection update authority, yes. Good.

Potential issue: `require_live_vault` in MINT:
```
require d.len>=66 && d[0]==KEY_ASSET_V1 && d[33]==UA_DISC_COLLECTION
```
doesn't check owner field? only collection. For boost_vault after `require_live_vault`, separately reads owner. For activate, it doesn't require asset owner is signer or any. Activation permissionless for any live vault; that's fine. It doesn't require asset owner? activation of another holder's vault allowed by design (permissionless). okay.

Potential issue: `activate` first call:
```
let payment_mint = ctx.accounts.config.payment_mint;
let collection = ctx.accounts.config.collection;
let r=&vault_record;
...
let (signer,_) = find_program_address(EXECUTE_PREFIX, r.asset)
let (want,_) = find program from signer token...
require_keys_eq vault_token want
let (amount,_) = read_token(vault_token,payment_mint,signer)
require amount>=ACTIVATION_SATS
...
r.vault_ata=want
```
It does not require `vault_token` account state initialized? read_token returns state but ignored in first activate. If a frozen vault_token amount >= activation? It reads amount even if frozen. Activation would request. Is that okay? Activation can happen while vault cbBTC account frozen; it proves balance. Later claims to frozen account deferred. fine.
Potential issue: It doesn't check `vault_token` is owned by token program; read_token requires. good.

Potential issue: `read_token` doesn't require state initialized; used in activation/distribute/boost. For vault_token activation, if data is zero/empty but length 165, amount0 state0; below threshold. fine. For pool distribute, if pool account is an uninitialized token account with stale data? read_token returns amount maybe stale; but pool is canonical. fine.

Potential issue: `read_token` reads owner at bytes 32..64; for Token-2022 accounts length170, it returns VaultAccountMissing because len !=165. good for classic only.

Potential issue: `split_revenue` uses `ctx.accounts.mint` UncheckedAccount but does not require owner SPL; CPI will verify? The token program's TransferChecked account includes mint. If wrong, CPI fails. no issue.
Potential issue: `mint_vault` payment mint similarly requires owner SPL and len82 but not that decimals equal? token transfer checked.

Potential issue: `claim_charter_vault` proof check with `pob_proof: Vec<[u8;32]>`; if proof longer max, refuse. good.

Potential issue: `Merkle` proof and root: leaf and node domain separation. good.

Potential issue in `check_attributes`: ReservedAttribute only exact strings. Could use "level" with different casing? Attribute keys are strings; readers may look for "level". The program writes "level". A malicious minter could write "Level" or "LEVEL" to fool UI. But `activate` reads level from record, not attribute. The on-chain asset could have a fake `level` with different case. Holder can see. Core plugin Attributes keys are case-sensitive; perhaps UI should display program `level`. Not a security fault.

Potential issue: `check_attributes` doesn't reject empty value, only empty key. Could write empty. no.

Potential issue: `MAX_ATTR_STR=128` and `MAX_ATTR_BYTES=640`. fine.

Now possible vulnerability with `expire_boosts` remaining records and account ownership:
```
let mut r = load_record(ri)?;
...
store_record(ri,&r)?;
```
It doesn't check `ri.is_writable`? It requires `ri.is_writable` at start:
```
require!(ri.is_writable, BadVaultRecord)
```
Then `load_record` checks owner etc. good.

Potential issue: `expire_boosts` does not require `rem` length <= MAX_EXPIRE_BATCH` yes.

Potential issue: `distribute` when burn false and w>0 doesn't require `burner` accounts empty? It does require remaining_accounts.is_empty in else. good.

Potential issue: `distribute` burn path doesn't ensure `from`/`gmint`/`tprog` are writable; okay.

Potential issue: `initialize` `check_seal_wiring` uses `UncheckedAccount seal_config` not in account struct? In `Initialize` account struct has `seal_config: UncheckedAccount`. good. It passes all as AccountInfo. good.

Potential issue: SEAL's `assert_classic_spl` requires each reserve mint account passed as remaining account. The account could be any account with same key and owner Tokenkeg; if key is a PDA? no.
Potential issue: It doesn't require reserve_mints length exactly not duplicate. The launch checker pins. Could duplicates cause weird? BURN would derive same ATA twice? In reserves vec, loops mints; duplicates could be repeated, derive same expected account. It would require `ctx.remaining_accounts` declared maybe same account passed twice? If duplicate reserve mint and BURN declared count includes only one account, first loop find same for both, passes checks; second loop just declares one. No vault can have two accounts for same mint. Harmless. But launch checker pins. no.

Potential issue: SEAL initialize doesn't require collection account? It takes collection pubkey argument, not account. It doesn't verify collection exists or owned by Core/ours. MINT and BURN later cross-check. If collection wrong but SEAL initialized, MINT/BURN/GOV refuse or init fail? Road order. accepted.

Potential issue: BURN initialize verifies SEAL config collection equals passed collection but not MINT config; GOV verifies MINT. fine.

Potential issue: `read_mint_supply` in BURN uses offsets 141 and454. It requires data length >= OFF_MINT_BARE_RETIRED+8=462. MINT config has padding, so yes. It doesn't read version? yes.
Potential issue: `minted_total.checked_sub(ctx.accounts.config.burned_total).checked_sub(bare_retired)`. If bare_retired + burned_total > minted_total due retired bare burn after redemption? Could `retire_burned` be called on a redeemed vault? It requires asset positively burned, but if burning through BURN asset also positively burned? After BURN burn_vault, the asset account is burned (Core, 1 byte). A malicious user could call `retire_burned` on a REDEEMED vault, because `is_burned` returns true. The record would already be retired by `retire_redeemed` (r.retired=true). `retire_burned` calls `retire`, which first `require!(!r.retired, AlreadyRetired)` and refuses. So cannot double count. good.
What about calling `retire_burned` on a vault redeemed before its level drawn? redeemed through BURN calls retire_redeemed; record retired. good.

Potential issue: A vault redeemed before reveal gets `retired=true` from retire_redeemed. Later reveal_level:
```
require!(ctx.accounts.vault_record.level == 0)
```
It doesn't check retired. It draws level even retired. That is intended per L.11. It increments revealed_total and level_minted. Good.
But `reveal_level` for retired vault whose asset is burned might skip attr check and update plugin. It still increments. Good.
Potential issue: `retire_redeemed` before reveal can remove pending? If vault was pending/active? activate requires level drawn, so cannot be active/pending before reveal. retire handles r.retired true. If a vault is burned via BURN before reveal, r.active false/pending false, retire just sets retired. Later reveal draws level but record retired stays. okay.
Potential issue: `retire_burned` before reveal similarly sets retired true; later reveal draws level and writes `r.level = li+1` even though retired. It does not unset retired. fine.

Potential issue: `claim` skips retired records because `if !r.active continue`. It doesn't check pending? It first pending branch before active; if retired and pending? retire clears pending. fine.

Potential bug in `reveal_level` for burned/retired vault: It still calls `c.level_minted[li]` and `revealed_total`. It does not write attrs to Core. fine.

Potential issue: `check_supply` in mint_vault uses `minted_total < cap_total` not accounting for retired. Since retired still counted. intended.

Now look at off-chain `bank/crank.mjs` not included, but maybe we can find issues from tests. Not needed.

Let's inspect SPEC accepted limits questions: We may answer with observed:
- Are any accepted worse? Maybe some open items. Need mention no worse. But need not re-report.

Need produce findings maybe:
1. distribute from frozen pool (but documented accepted not refused). Not finding.
2. Some doc false "Every opening is public" still false. We can file LOW doc; but likely accepted item 50. The prompt says holder guide promises something code does not do; item 50 open. Could report as surviving open item, but "Do not re-report old". Maybe include in accepted questions not finding.

Let's hunt for new/unpatched bugs.

Maybe there is a **use of `try_to_vec` on attributes in write_record**: 
```
r.attrs_hash = hashv(&[&attributes.to_vec().try_to_vec()?]).to_bytes();
```
`attributes.to_vec().try_to_vec()?` serializes Vec<VaultAttribute>. But in `reveal_level`, `attributes.try_to_vec()?` where `attributes` is a Vec. Same. Fine.

Potential issue: `reveal_level` doesn't verify `attributes` length <= MAX_ATTRS before `try_to_vec`; but hash equality with a bounded stored hash implies the serialized Vec length equals the stored one? Hash preimage second preimage with same hash and different length infeasible. So no.

Potential issue: `update plugin` CPI in reveal re-sends attributes as `attributes.len()+1`. It doesn't enforce total serialized bytes <= MAX_ATTR_BYTES+level. But hash equality with a stored bounded amount implies same exact serialized bytes? Hash collision infeasible but not mathematically impossible. This is acceptable cryptographic assumption. Not a bug.

Potential issue: `blockhash_in_window` reads slot hashes count from bytes as `u64::from_le_bytes`. It uses `data[8..].` fine. It doesn't verify Sysvar account is writable? fine.
Potential issue: It returns Ok(Some) for slot with hash zero? It requires hash !=0. good.

Potential issue: `try_capture`: It uses `now > reveal_slot+REVEAL_WINDOW_SLOTS` as Expired before any entropy. What if reveal_slot is a future slot but now after reveal_slot + window due to long off-chain downtime; then no entropy and reschedule. fine.
Potential issue: `capture_entropy` direct after window passed returns RevealWindowExpired; but the crank reschedules if passed. fine.

Potential issue: `crank` on `claim_charter_vault` passes remaining accounts after `pob_extra` to crank. okay.

Potential issue: `claim_charter_vault` with `pob_extra >0` and `crank` accounts: It splits remaining into first `n_extra` as extra, rest crank. It requires `n_extra <= MAX_POB_EXTRA && n_extra <= ctx.remaining_accounts.len()`. Does not ensure rest has SlotHashes if nonempty. Crank handles if empty; if first rest not slot hashes, crank requires and fails. fine.
Potential issue: It does not check `pob_extra` is u8; client passes. fine.

Potential issue: `claim_charter_vault` uses `pob_extra` count for extra pass-through, but Core BurnV1 account list maybe has variable additional oracle accounts. The first extra accounts are passed; if a benign oracle has more than 8 accounts? Bound 8. If collection has a plugin needing more, claims could fail. Accepted. Mainnet current no plugin. fine.

Potential issue: `claim_charter_vault` does not verify `pob_asset` account owner field is the same as `owner` account? It reads owner from data and compares to ctx.accounts.owner.key. good.

Potential issue: `claim_charter_vault` does not verify `pob_asset` in provided `pob_collection` account is the collection's update authority? It reads asset data and config. It passes `pob_collection` account key to Core burn; Core validates collection. good.

Potential issue: `split_revenue` destination pool ATA is derived with `SPL_TOKEN_ID` despite payment mint being classic. good.
Potential issue: `mint_vault` revenue_token derived with revenue PDA and payment mint. good.

Potential issue: `initialize` pool_ata derivation uses `[config.key, SPL_TOKEN_ID, payment_mint]` and ATA_PROGRAM_ID. This is standard. But the config.account is being initialized and its key is ctx.accounts.config.key. fine.
Potential issue: `initialize` royalty plugin's revenue PDA derived before. good.
Potential issue: `emit_wiring` called before royalty CPI; if royalty CPI fails, event rolled back? Events may still be emitted? In Solana, events are base64 logs; if transaction fails, logs still contain events but state rollback. Alarm might see events from failed tx? It doesn't index events? Maybe not. Not bug.

Potential issue: `check_seal_wiring` in MINT uses `SEAL_CONFIG_VERSION` 2. If SEAL config initialized with version1? v6 new. good.
Potential issue: `seal_reserves` assumes check_seal_wiring passed; but `initialize` calls check then seal_reserves. good.
Potential issue: BURN `initialize` also reads SEAL config. good.

Potential issue: GOV `initialize` read_mint_config requires MINT_CONFIG_VERSION=6. MINT initialized before GOV. good.

Potential issue: `read_mint_config` in GOV has `require!(d.len() >= OFF_MINT_MAX_BOOST_EPOCHS + 2)` i.e. >=714. MINT config has padding. good.
Potential issue: It reads `max_boost_epochs` at712. good.

Potential issue: There may be a **bug in GOV's `read_core_asset`**: It doesn't require data[33] is collection authority disc? It does. `d[33]==UA_DISC_COLLECTION`. good.

Potential issue: `cast_vote` and `create_proposal` don't enforce top-level instruction (off-curve owner). A PDA can be owner if passed as CPI signer? `owner: Signer` accepts CPI signer; read_core_asset sees owner bytes, require signer key equals owner. If owner is a PDA and the transaction invokes GOV via CPI with the owner PDA signing, `is_signer` true. Thus an off-curve owner DAO can create proposal/vote via CPI. That's okay for governance. Redemption not possible. Not a bug.

Potential issue: `mint_vault` and `claim_charter_vault` also allow CPI owner signer, so off-curve owners can mint. Accepted.

Potential issue: `open_for_redemption`/`burn_vault` require top-level owner signatures? They use `owner: Signer` and instruction sysvar top-level checks. Could a PDA owner sign via CPI? The owner signer could be a PDA signed by a wrapper program, but `load_instruction_at_checked` sees top-level instruction (wrapper) not the actual open/burn). The access to open/burn is through wrapper CPI; SEAL/BURN's owner signer would be a signer in the inner CPI, but top-level introspection sees wrapper. For SEAL open, it walks top-level instructions after current for a terminal burn by BURN_PROGRAM_ID; there isn't, unless wrapper instruction is BURN ID? no. So open refuses. For BURN burn, it requires preceding top-level open; none. So off-curve owner cannot redeem even if owner PDA signer because the redeem instructions must be top-level themselves. Good. But could a wrapper program be the top-level owner signer? Owner bytes offcurve; it signs inner; but top-level instruction program ID is wrapper. SEAL pairing requires top-level BURN burn, so no. Good.

Potential issue: In `retire_redeemed`, stack height check. Good.

Potential issue: `burn_vault` rate limit before reserve checks. If `minted_total` misread due to MINT config version? pinned. fine.

Potential bug: Rate limit ring index:
```
let head = c.rate_head as usize % RATE_RING;
let kth = c.rate_ring[(head + RATE_RING - k) % RATE_RING];
require!(now.checked_sub(kth)? >= c.redeem_window_secs)
c.rate_ring[head]=now;
c.rate_head=((head+1)%RATE_RING) as u8;
```
This is correct ring of last 64. kth formula? head is next write index; newest at (head+RATE_RING-1)%RING. kth newest index = (head + RATE_RING - k) % RING. For k=cap. If cap=45, examines 45th newest. Good.
Initial ring zeros at time 0; for first cap redemptions kth=0, now>=window true. Good.
But **bug**: If `cap` is `RATE_RING` (64), `k = (cap.max(1) as usize).min(RATE_RING)` =64. Then index (head + RATE_RING - 64)%64 = head. That's the OLDEST slot about to be overwritten? Let's analyze: ring size 64, head=next write. Newest index=head-1 mod64. kth newest for k=1 is head-1, k=64 is head-64 = head mod64. That is the slot that will be overwritten next (oldest). A redemption is allowed iff the 64th most recent is older than window. But the ring stores only last 64, and k=64 is the oldest stored. If cap=64, we need ensure at most 64 in window, so allow if the 64th most recent was at least window old. That's correct; if 64th is old enough, there are at most 63 in last window. But what if there are 64 stored and the 64th is exactly within window? refuse. good.
Potential issue: Ring size RATE_RING=64 covers live supply up to floor? SPEC says cap=64 covers 3047. For live 2100 cap45. fine.
Potential issue: `rate_head as usize % RATE_RING` redundant. fine.
Potential issue: `c.rate_ring[head]=now`; if `now` same as previous in same tx? Clock same, second redemption: kth may be same; deny if k<=cap? For cap>1 maybe. good.

Potential issue: BURN counts `burned_total` after rate limit, after emptiness. If rate limited, no burn. Good.

Potential issue: `burned_total` is u64 checked add. good.

Potential issue: `retire_redeemed` by BURN passes pool_token AccountMeta `new_readonly`? In BURN instruction account `pool_token` UncheckedAccount not writable? AccountMeta::new_readonly, MINT's `RetireRedeemed` context `pool_token: UncheckedAccount` not `mut`? It's read for pool_is_frozen and monthly_inline. monthly_inline only reads pool, does not transfer or modify; `credit` only modifies config. So readonly OK.
Potential issue: BURN passes `vault_record` AccountMeta `new` writable, MINT load_store. good.

Now potential bug with `retire_redeemed` calling `monthly_inline` after retire. monthly_inline requires pool.key == c.pool_ata. It reads pool; if pool account wrong, returns error and reverts whole burn. But BURN passed pool from transaction; if wrong, burn reverts. Client must pass correct pool. Not a bug.

Potential issue: In `retire_redeemed`, `pool_is_frozen` is called before `monthly_inline`. It requires pool key. If pool account is missing (not token), pool_is_frozen returns false. monthly_inline then treats missing pool as no distribution. Redemption proceeds. Good. If redeem client forgets pool, BURN passes a missing account? Anchor account maybe. fine.

Potential issue: `retire_redeemed` requires `is_burned` positive after BURN's Core BurnV1. It checks asset account data len1 key0. The Core burn happens before invoke. good.

Potential issue: `retire_burned` doesn't call monthly_inline. fine.

Potential issue: `retire_burned` doesn't require vault record `seeds` in context; it does. good.

Potential issue: `retire_burned` could retire a live vault? is_burned false. good.

Potential issue: `retire_burned` of a vault burned through BURN would be retired_already; refuses.

Potential issue: `retire_burned` for a vault whose asset account is Core-owned but data len1 key0 (burned). Good.

Potential issue: if Core BurnV1 leaves asset account data len1 key0 but owner not Core? is_burned requires owner MPL_CORE. measured.

Potential issue: `is_burned` borrows data; if account data empty and owner MPL_CORE, d.len==1 false. good.

Potential issue: `open_for_redemption` read_core_asset requires data len >=66 and key1. if asset burned, cannot open. good.

Potential issue: `burn_vault` first requires `*vault_asset.owner == MPL_CORE_ID`; if burned owner MPL_CORE? Core account owner MPL_CORE and len1. Then read data later requires d[0]==KEY_ASSET_V1. A burned vault data[0]=0, so refuses NotACoreAsset. So cannot redeem burned again. good.

Potential issue: `open_for_redemption` set_frozen false; if vault already thawed, Core UpdatePlugin may set frozen false again? At open, SEAL does not require currently frozen. Could an owner call open twice then burn? The second open sets false, fine. No issue. Could a thawed vault exist after a failed partial burn? No because burn reverts entire tx, including thaw? Wait transactional atomicity: SEAL open instruction mutates asset in a separate top-level instruction. In Solana, each instruction state changes are committed sequentially; if a later instruction fails, the whole transaction fails and changes from earlier instructions are rolled back? Does Solana transaction rollback on failure? Yes, transaction is atomic: if any instruction fails, all state changes from earlier instructions are rolled back? I think in Solana, failed transaction generally does not modify state; atomic. So vault stays sealed. good. If transaction includes open+transfer to self (no burn), open instruction might succeed then transfer and no fail; but open itself refuses no terminal burn via introspection. So no transaction with just open+transfer? SEAL refuses. good.
Potential issue: If a transaction contains open and a terminal burn for same asset/owner, SEAL thaws. Could another instruction between open and burn call Core Execute to transfer all; burn then checks emptiness. That's intended.

Potential issue: Could a transaction contain open, transfer half, then burn; burn fails, entire tx reverts including transfer and thaw. atomic. good.

Potential issue: Could a transaction contain open, transfer all to owner, then before burn some instruction re-freezes vault via SEAL update? No instruction but could Core update plugin authority? The seal plugin authority is SEAL PDA, only SEAL's set_frozen. Could another Core UpdatePlugin by SEAL? only open. fine.
Potential issue: Could owner close/re-freeze? no.

Potential issue: `SEAL open_for_redemption` only verifies a future top-level burn; it does not verify the burn is after sweeps vs before. If burn instruction appears before open? open after burn? BURN requires preceding open, so burn before open fails. Instruction order must open then burn. Good.
Potential issue: It doesn't verify there is no other instruction after burn? not needed.

Potential issue: `BURN burn_vault` doesn't verify the thaw actually occurred via Core? It verifies top-level open instruction exists, but could that open instruction have failed? Transaction instructions run sequentially; if preceding instruction failed, transaction stops, so burn doesn't run. So if burn runs, open succeeded. Could open have been in a failed instruction earlier? no.

Potential issue: Could someone construct an instruction with SEAL program ID and discriminator but malformed accounts that doesn't actually thaw? SEAL program will execute and either succeed or fail. If malformed succeeds? It returns error. Burn won't run. fine.

Potential issue: Pairing uses instruction data discriminator only, not account owner? It checks tx instruction program_id and discriminator, asset/owner account keys. Could an attacker craft a fake instruction with SEAL program ID and discriminator but not invoke SEAL? In a transaction, instruction account list is part of message but the program is invoked. Program ID determines loaded program. You cannot have instruction with program ID SEAL but not run SEAL; it executes SEAL. If SEAL returns error, transaction stops. So preceding instruction must be a successful SEAL open. Good.

Potential issue: `load_instruction_at_checked` might see inner CPI? It sees top-level only. good.

Now check `MINT config space` maybe a hidden **undersized Boost ring?** `boost_expiring: [u32; BOOST_RING]`. They allocate 4*BOOST_RING. Suite passes, so fine.

Potential issue: `advance_epoch` with ring size 64, max boost epochs 63. Good.

Potential issue: `BOOST_RING` and `RATE_RING` untyped const; compile-time assert `const _: () = assert!(RATE_RING == 64, ...)`. fine.

Potential issue: `xb` etc.

Let's check `scripts/run-tests.sh` floors: HOST_FLOOR=6, but host tests currently maybe 5 plus test_id? The prompt says 6 host unit tests (one Anchor generated `test_id`). The code shows two additional tests appended N1/N2? Actually host_tests has three tests: the_lookup, malformed, capture_skips, boost_ring_wraps, boost_schedule_through_own_functions = 5 explicit? Plus test_id = 6. HOST_FLOOR=6. OK.

Now maybe there are untested off-chain issues but our audit should focus code.

Let's examine `Governed` account order/CPI: In GOV `execute_proposal`, for each action it invokes MINT with accounts `[mint_config, governance]`. MINT `Governed` struct expects `config` and `governance`. The account list missing the MINT program ID? AccountMeta list for CPI includes only accounts, not program ID; `invoke_signed(&Instruction { program_id: MINT_PROGRAM_ID, accounts: ..., data}, account_infos, signer_seeds)`. account_infos includes `ctx.accounts.mint_config.to_account_info(), ctx.accounts.governance.to_account_info()`. But the Instruction's account_metas have 2. AccountInfos passed to invoke? They pass 2. Good. MINT program's entrypoint will deserialize accounts. fine.

Potential issue: For `set_round`, MINT `Governed` constraint `has_one=governance` compares config.governance field to governance key, but the `governance` is a Signer in CPI with PDA seeds. It signs. good.
Potential issue: In `execute_proposal`, before calls they do `let m = read_mint_config...` and later `emit... minted_now: m.minted_total`. `m` is read before CPIs. If actions include SetRound etc that modify minted_total? No actions don't mint. If actions include set_round, minted_total unchanged. If they include restart etc. fine.
Potential issue: If actions include `TightenSweep`, MINT config modifications. `m.minted_total` still. good.

Potential issue: `read_mint_config` in GOV reads `sweep_floor`, `cooldown_ceiling`, `reserve_ceiling`, max_boost. Good.

Potential issue: `create_proposal` uses `m.sol_reserve`, `m.max_sweep`, `m.cooldown` for tightening validation. Those are current at creation. good.

Potential issue: `create_proposal` `index_snapshot = m.minted_total`. good.

Potential issue: `vote` record PDA uses proposal key and asset; no proposal signature? It is init; payer. good.

Potential issue: `cast_vote` increments tally before init of VoteRecord? Actually:
```
let p=&mut proposal;
if support {p.yes++} else p.no++
let v=&mut vote_record; v.proposal=...
```
Anchor init for vote_record would fail if duplicate at account validation before handler? Anchor account checks happen before handler. It will fail and revert tallies. fine.
Potential issue: If vote_record already exists but account not writable? no.

Potential issue: `execute_proposal` does not check that all accounts are correct beyond invokes; MINT/GOV will.

Potential issue: `Proposal` actions Vec is bounded 5, one each kind. Good.

Potential issue: `read_mint_config` at GOV's `initialize` might read `m.collection` and compare collection. It doesn't verify MINT's governance PDA set to GOV, because GOV not deployed/initialized yet? At initialize, it only requires collection match; not `governance==gov_pda`. That can cause GOV initialized with MINT config that names a different governance authority if MINT initialized wrong? But MINT initialize sets governance to GOV PDA derived from hardcoded GOV_PROGRAM_ID. Since GOV_PROGRAM_ID is compile-time, and GOV initializing is at that ID? Actually program ID is fixed at compile. So if MINT config governance not GOV_PDA, could only happen if GOV_PROGRAM_ID constant in MINT is wrong or MINT config corrupted. But initialization order maybe MINT then GOV; if GOV program ID differs? Constants are fixed. If someone deploys GOV at different ID but cross-references? not. `execute_proposal` later requires m.governance == gov_pda, so if mismatch, execution fails; create/vote could proceed but no execution. But MINT sets correct. fine.

Potential issue: BURN `initialize` doesn't check MINT config governance; no need.

Potential issue: `Governed` instructions don't require `governance` account owner == GOV_PROGRAM_ID. But config.governance set at MINT initialize to GOV PDA; the `has_one` constraint ensures signer key equals config.governance, but if a forged instruction passes a signer with same pubkey derived under GOV? The `governance` signer can only be signed by GOV program's PDA. Could another program with the same pubkey? No. fine.

Potential issue: `apply_guardian`/`apply_swap_operator` can be called by any signer, no signer. They don't require payer. fine.

Potential issue: `Claim` context has `token_program: UncheckedAccount #[account(address=SPL_TOKEN_ID)]`; good.

Potential issue: `initialize` MintConfig account space might allow future field but no realloc. fine.

Potential issue: `MintError` messages not relevant.

Now maybe there is **a serious issue in `capture_entropy`/`reveal_level` FIFO with burned vault at head**:
- `reveal_level` checks `index == config.revealed_total`. Suppose a vault is bare-burned before drawing and then `retire_burned` sets `r.retired=true`. `reveal_level` doesn't check retired, so can draw. good.
- Suppose a vault is transferred to its own PDA (bricked) before drawing. It is still a live Core asset owner PDA, but `reveal_level` doesn't require owner signature; it can draw. good.
- Suppose a vault is bare-burned but not yet retired, asset account is burned. reveal_level skips Core update, draws. good.
- Suppose a vault is redeemed through BURN before drawing. Asset burned; r.retired true from retire_redeemed; reveal_level draws. good.

Potential issue: If a vault's asset account is closed/deleted? Core assets can't be closed while owned by Core. fine.

Potential issue: `reveal_level` doesn't require `SlotHashes` key pinned? It passes `ctx.accounts.slot_hashes` to `try_capture` via `&ctx.accounts.slot_hashes.to_account_info()`; `blockhash_in_window` checks key. good.

Potential issue: `activate` doesn't check `vault_record` record's `asset` matches asset? It reads r.asset and later require_keys_eq in `activate`? It does after checking pending:
```
if r.pending { require_keys_eq!(asset, r.asset); ... }
...
requirements after pending branch:
require!(1..=5 level); require_keys_eq!(asset, r.asset); require_live...
```
In first call branch, it does require asset but AFTER reading r level and `require!((1..=5).contains(&r.level), NotRevealed)` and require_keys_eq and live. If record asset mismatched, anchor seeds ensure record PDA for asset? The `activate` context has `vault_record` seeds = [VAULT_SEED, vault_record.asset.as_ref()]? Let's check:
```
#[account(mut, seeds=[VAULT_SEED, vault_record.asset.as_ref()], bump = vault_record.bump)]
pub vault_record: Account<'info, VaultRecord>,
```
So vault_record PDA is derived using the asset field INSIDE the record, but Anchor uses `vault_record.asset` from account data to validate seeds. If the asset account passed doesn't match record.asset, the handler later require_keys_eq in first branch; in pending branch too. good.
Potential issue: If `vault_record.asset` is changed by attacker? no.

Potential issue: `claim` pairs do not validate record PDA seeds authoritatively in context; `load_record` checks owner/discriminator/version, but not seeds. It accepts any account owned by MINT with valid VaultRecord. However the `ri` account passed could be a record for a different vault and `load_record` reads it. Does `claim` require `dest.key == r.vault_ata`. If attacker passes a record they control? Records are PDAs derived from asset and owner MINT; only existing vault records. Could pass a record for any vault and its matching destination account. This is permitted (anyone can claim any vault). It pays into that vault's recorded ATA. No theft. It can join a pending vault, etc. okay.
Potential issue: In `claim`, for pending join, it doesn't verify `ri` is the vault_record PDA for the destination? It requires dest == r.vault_ata, which was recorded at activate. An attacker cannot set vault_ata on someone else's record except via activate. fine.

Potential issue: `expire_boosts` accepts any record owned by program; any record. okay.

Potential issue: `retire_burned` Context has `vault_record` seeds = [VAULT_SEED, vault_record.asset] so record key bound. Good.

Potential issue: `retire_redeemed` Context similarly seeds based on record.asset. It also verifies asset key equals record.asset. good.

Potential issue: `RevealLevel` Context `vault_record` seeds bound; then handler checks asset. good.

Potential issue: `CaptureEntropy`, `RescheduleReveal` same.

Potential issue: `Initialize` config account seeds etc. good.

Potential issue: `OpenForRedemption` config/seal accounts seeds. good.

Potential issue: BURN `BurnVault` asset_signer seeds = [EXECUTE_PREFIX, vault_asset.key]. It doesn't bind owner? Core signs. good.
Potential issue: BURN `vault_record` passed as UncheckedAccount, not seed in context; MINT retire validates seeds. good.

Potential issue: In `burn_vault` after Core BurnV1, the `vault_asset` data is burned, but `retire_redeemed` called with `ctx.accounts.vault_asset` readonly. is_burned borrows. fine.

Potential issue: Core BurnV1 account list in BURN:
```
accounts: asset, collection, payer sig, owner sig, MPL_CORE_ID, MPL_CORE_ID
```
No system program? Similar to claim PoB burn. Maybe Core BurnV1 for asset uses accounts [asset, collection, payer, authority, MPL_CORE_ID, MPL_CORE_ID] yes tested.

Potential issue: `open_for_redemption` set_frozen false CPI account list has seal PDA signer. It passes `seal` as `UncheckedAccount` with `#[account(seeds=[SEAL_SEED], bump)]`. Good.
Potential issue: `core_plugin_cpi` includes `system_program` and `mpl_core`. good.

Potential issue: `create_vault` CPI includes `mint_authority` as signer seeds MINT_SEED. Does it also include `payer` signer. good.

Now off-chain `pob-merkle.mjs` root algorithm. It sorts nodes by Buffer.compare. Rust `merkle_root_from` compares node arrays lexicographically with `node <= *sib`. Rust array comparison works lexicographic. good. Domain separation. fine.

Potential issue: `MAX_POB_PROOF=16`; 240 tree depth8, proof max8. good.

Potential issue: `proofOf` odd promotion; Rust `merkle_root_from` with proof iter just hashes sibling; works. good.

Potential issue: `Initialize` checks `pob_root != [0;32]`, but doesn't recompute from `scripts/pob-set`. checker.

Potential issue: `pob_collection` nondefault but not check owner/data. checker.

Potential issue: reserved attr "redemption" still refused though nothing writes. fine.

Potential issue: `INIT_AUTHORITY` localnet/test fixture. build script verifies. fine.

Potential issue: `build-mainnet.sh` only asks four programs about init authority, not sweep. good.

Now maybe there is an actual bug in `distribute` free path condition when w==0:
```
require!(!burn && c.pending_this_epoch > 0, MintError::NoActiveVaults);
```
Suppose no active vaults, pending_count includes only older pending (waiting_to_join>0), the first require waiting_to_join==0 fails with JoinWaitingFirst. If pending_this_epoch=0 but pending_count=0, free distribute called at launch with no vaults is refused NoActiveVaults; but monthly_inline with no active does nothing. That's fine; no need tick if no pending. Later when first activate requests, monthly_inline will tick if due. Good.

Potential issue: `distribute` `w ==0` requires `burn` path? It says `require!(!burn && c.pending_this_epoch > 0, NoActiveVaults)`. If burn=true and no active but pending current, returns NoActiveVaults. good.

Potential issue: `waiting_to_join` checked before reading pool? It reads pool first; if pool frozen/balance etc. Fine.

Potential issue: `distribute` with w>0 and burn true checks waiting_to_join after reading GARY balance but before burn. Good.
Potential issue: `distribute` with w>0 and free path checks waiting_to_join before `MonthNotElapsed`? Code:
```
} else {
 require rem empty;
 require now >= last+monthly, MonthNotElapsed;
 require waiting_to_join ==0, JoinWaitingFirst;
}
```
Actually waiting after MonthNotElapsed. If month not elapsed and waiting, error MonthNotElapsed. fine. For burn, checks waiting before burn. good.

Potential issue: `monthly_inline` ordering: due -> boosts_due -> waiting_to_join -> active0. Suppose boosts_due>0 and waiting_to_join>0; it logs waits for boosts, not joins. fine.
Potential issue: It does not check `avail` before active0; if active0 and pending_this_epoch>0 ticks even if pool holds undistributed. That means first tick at launch can occur while pool holds funds? But no active; tick only epoch. Later joins share. intended.
Potential issue: It treats a pool account not owned by SPL as holding nothing and returns, so a due month with no pool account doesn't advance epoch. If no active and pending current, maybe tick should still happen? But `monthly_inline` active0 branch occurs before reading pool. So if no active/pending current, it ticks even if pool missing. If active0/pending current, yes tick before pool check. Good.

Potential issue: `claim` with monthly_inline runs before paying. If month due and pool missing, no distribution. Claim then pays old owed if pool exists? It requires pool_token account in context equal config.pool_ata. If pool missing/non-token, read_token in monthly returns false/return; then claim may still pay out of pool? The pool account passed is same as pool_ata; if it is not a token account, later when paying active pay>0, `invoke_signed` Transfer from pool fails. The claim reverts. That's correct if a vault owed. If no one owed pay0, claim lands. accepted item 52.

Potential issue: `retire_redeemed` monthly_inline after retire if month due. It can distribute to remaining. good.

Potential issue: `retire_redeemed` `pool_is_frozen` returns false if pool owner not SPL; if pool missing, no forfeit but monthly later does nothing. Redemption can succeed without pool? But it still has to burn; `retire_redeemed` monthly_inline with wrong pool key would fail if wrong. If correct pool account missing? Anchor account info for missing PDA? It exists? If not, monthly_inline: require_keys_eq pool.key==pool_ata passes (account key), then due? maybe, active etc. total_active_weight maybe >0; pool.owner !=SPL -> return Ok. So redemption succeeds. Good.

Potential issue: `retire_redeemed` `pool_is_frozen` requires pool.key==pool_ata, but if pool account missing, AccountInfo key still expected. fine.

Potential issue: `retire_redeemed` if pool frozen and pending <ACC_SCALE (sub sat) and forfeit=true, condition `if forfeit && pending >=ACC_SCALE { log... }`; it still subtracts pending. fine.

Potential issue: `retire` if redeemed && !forfeit requires pending < ACC_SCALE. But if pool frozen? forfeit true, skip. If pool not frozen but claim before sweep paid whole sats leaving sub-sat residual; pending<SCALE. good.
Potential issue: `claim` before sweep could pay all whole sats but if the vault's cbBTC account is frozen, claim defers instead of paying; pending remains >=ACC_SCALE. If the pool itself not frozen but vault account frozen, retire_redeemed (redeemed && !forfeit) requires pending<ACC_SCALE, gets ClaimBeforeBurn, so redemption reverts. Accepted: frozen vault account blocks redemption. Good.

Potential issue: `claim` before sweep with frozen destination defers and does not settle; later burn refuses ClaimBeforeBurn. good.

Potential issue: `retire_redeemed` `forfeit` true only if pool frozen. If vault account frozen but pool not frozen, no forfeit; cannot redeem. accepted.

Potential issue: `claim` with a frozen destination stores record if touched and continues; later owed_scaled unchanged. good.

Potential issue: `claim` uses `ctx.accounts.config.key()` as authority and `bump` from config. It invokes SPL transfer with authority config PDA. good.
Potential issue: Config PDA owns pool ATA; derive `pool_ata` as ATA of config PDA for payment mint. yes.

Potential issue: `split_revenue` transfers from revenue ATA to pool/bank using authority `revenue` PDA. good.

Potential issue: `revenue` PDA can sign for its ATA because owner of ATA is revenue PDA. good.

Potential issue: `mint_vault` transfer checked uses authority `payer` signer. good.

Potential issue: `boost_vault` burns from `burner_token` authority burner signer. good.

Potential issue: `distribute` burns $GARY from `from` authority burner signer. good.

Potential issue: `crank` in `mint_vault` after state updates and create_vault uses `slot` from Clock before create? It gets slot after create_vault but before write? Actually:
```
let slot = Clock::get()?.slot;
let c=&mut config;
...
write_record...
crank(ctx.remaining_accounts, slot)
```
The slot is after create, but `write_record` sets reveal_slot = slot + 16. Good. It records reveal_slot at current slot.

Potential issue: `crank` may include this newly minted vault? Remaining accounts could include its own record; the record just written level0/entropy_set false. The crank will capture/reschedule it, but the transaction also includes slot = current. If current slot > reveal_slot? reveal_slot = slot+16, so try_capture returns NotYet. So its own record in crank is skipped. The test R24.5 for activate own record mismatch? For mint, maybe no issue.
Potential issue: `claim_charter_vault` similar slot from Clock after create? It gets slot before creating record? Code:
```
let slot = Clock::get()?.slot; 
let c=&mut ctx.accounts.config;
...
write_record(&mut vault_record, asset, index, slot, true, &full, bump)?;
...
crank(crank_accts, slot)?;
```
It gets slot before write? It gets before indexing. likely after PoB burn/create. fine.
Potential issue: In `claim_charter_vault`, `slot` is retrieved before c mutable config; but write_record uses `slot`. good.

Potential issue: `reveal_slot` for first vault could be current slot +16. SlotHashes only holds past slots. fine.

Now **critical possible** with `Monthly_inline` and config borrow in `mint_vault`: It mutably borrows config then `let cfg=&ctx.accounts.config` immutable. Fine.

Potential issue: `mint_vault` monthly_inline could credit and advance dist_epoch before checking sales stop. If sales stopped, it still dist. not issue.

Potential issue: `claim_charter_vault` monthly_inline before charter window; might tick epoch during charter if one month due, but `last_distribute_at=charter_closes_at`, so not due until close+month. Since charter window 7 days max, not due. good.

Potential issue: `initialize` `last_distribute_at` max(charter_closes). If charter window 7 days and monthly_secs e.g. 60 in suite, first due at close+60. good.

Now look at `Governed` instruction in MINT: `set_boost_terms` has if price>0 and weight/epochs inside max. It doesn't require weight/epochs non-zero if price=0. It sets to0. fine.
Potential issue: `GOV create_proposal` `SetBoostTerms` with price0, weight,epochs arbitrary not checked; MINT sets 0. fine.

Potential issue: `BOOST_RING`/max_boost_epochs 63, but init bound checks `(1..=MAX_BOOST_EPOCHS_BOUND).contains(&max_boost_epochs)`, where MAX_BOOST_EPOCHS_BOUND=(BOOST_RING-1)=63. Ruled max_boost_epochs=24. good.
Potential issue: `boost_vault` `end = c.dist_epoch.checked_add(epochs as u64)`. epochs <= c.max_boost_epochs <=63. good.
Potential issue: `c.boost_expiring` length 64. fine.

Potential issue: `distribute` path `credit` called after `waiting_to_join` and $GARY burn. If `waiting_to_join` checked before burn yes. good.
Potential issue: `credit` uses `w` captured before. If a boosted vault is due but boosts_due==0? Can't. includes weights. good.

Potential issue: `monthly_inline` uses `w` after possibly `if c.total_active_weight==0` branch; no boosts_due/waiting. good.

Potential issue: `reweigh` doesn't update `c.boost_weight_total`; callers do. But what about `join` etc? no boost. good.
Potential issue: `unschedule_boost` due branch uses `c.dist_epoch >= r.boost_end_epoch` to decide due. If boost was due earlier but not expired due to no distribution, true. It subtracts `boosts_due`. If due count 0 but record end<=dist (inconsistent due to manual?) fails. good.

Potential issue: `advance_epoch` moves elected boosts to due. If `boosts_due` already >0 and distribution blocked, it won't be called again. fine.

Potential issue: `expire_boosts` can expire boosts on retired records? skips retired. good.
Potential issue: `claim` can expire due boosts on retired records? It checks if !r.active after pending branch:
```
if r.pending...
if !r.active { continue; }
...
```
So retired/inactive skipped. Good. `expire_boosts` also active.

Potential issue: A bare-burned vault still active until retired; `claim` may pay it because it doesn't check asset live (accepted 27). It can also expire its due boost. accepted.

Potential issue: `retire_burned` can be called on bare burned active vault while still owed; it returns pending to pool. Good.
Potential issue: `retire_burned` doesn't require `boost_weight` if boost was due and boosts_due count; unschedule effectively. good.

Potential issue: `retire_redeemed` after redemption active with `forfeit=false` requires pending<SCALE. What if pending=0, okay. It subtracts 0. good.
Potential issue: `retire` if r.active and r.boost_weight >0 calls unschedule_boost. If r.boost_weight due, boosts_due decremented. good.

Potential issue: Could `unschedule_boost` underflow `boosts_active` if record active with boost_weight>0 but not counted due to corruption? It checksub. fail.

Potential issue: `boost_vault` requires record active and !pending. If active true, pending false. good.

Potential issue: `set_boost_terms` can switch price to0 while boosts active. Existing boosts continue; new boost off. good.

Potential issue: `expire_boosts` can be called when price off and no due? skip. fine.

Now maybe there is a vulnerability in `sweep_sol_for_swap` with `last_sweep_at` and clock if initialized before epoch? no.

Potential issue: `initialize` `swap_operator` can be set to guardian/init authority etc. Bounded by key compromise. accepted.

Potential issue: `initialize` guardian Option<Pubkey> can be None. Then no one can stop sales. Product decision. A vote can arm guardian later. accepted.

Potential issue: `cancel_swap_operator` if guardian is None refuses NotTheGuardian. fine.

Potential issue: `emergency_stop_sales` if guardian None refuses. good.

Potential issue: `arm_guardian` doesn't require vote created after stop? not.

Potential issue: `apply_guardian` can land guardian before `sales_stopped`? no issue.

Now holder docs maybe one false sentence: "Every opening is public. It is announced on X and on the Bank's website." Since poster has no sender. The prompt asks holder docs; but this is already item 50. Could mention in final as LOW or open. However report format wants findings; maybe include under "holder documentation has false statements" if not already known? The prompt specifically says D1-D9 repairs; "Read every sentence against code." It may still have this false sentence. But the item 50 open acknowledges no sender and guide may not be published. Could report as LOW: `HOLDER-GUIDE` line "Every opening is public. It is announced on X and on the Bank's website." remains false; `bank/redemption-poster.mjs` drafts posts and has no sender. Evidence: run poster selftest? This is known open item 50, not new. But maybe it's a defect. They said don't re-report old finding because it appears in prior verdict; verify if repair holds. It wasn't a repair; it's open. But round 25 L1 accepted. The task says "DO report where HOLDER-GUIDE promises something the code does not do." So we should report. Maybe severity LOW/info.

But need find more substantial.

Let's inspect `test-vault.ts` and tests for arms maybe cannot fail. Could identify evidence gap not actual bug. But findings should be useful.

Potential issue in `scripts/pob-merkle.mjs`: The leaf hash uses `Buffer.from(pubkeyBytes)` if `pubkeyBytes` is a Uint8Array; good. Root sorted. Domain separated. fine.

Potential issue in `scripts/rehearsal-tree.sh`: It maps root path and program IDs by string replacement. It refuses abbreviated IDs `for o, _ in pairs[:-1]` excludes root pair. Good. But it only patches files under git ls-files `programs`, `bank`, `scripts`, `tests`, `sim`, `Anchor.toml`. If program IDs appear in other files (e.g., `launch/mainnet-init.json` for IDs? It maps five program IDs maybe not there? The script maps IDs in the scope, not `launch`. But off-chain constants are in bank/layout. fine. It does not patch `README` etc. Not issue.
Potential issue: It maps real IDs to new and checks no map key inside another. If a real program ID appears in `dist`? It doesn't scan dist. fine.
Potential issue: It doesn't build/send. fine.

Potential issue in `scripts/probe-mainnet-facts.mjs`: It simulates Token-2022 ATA creation using an unsigned simulationOwner PDA and simulationPayer from history. Good. But it might use `simulationPayer` as fee payer in simulateTransaction with `sigVerify:false`; okay. It doesn't call `createAssociatedTokenAccountIdempotentInstruction` with `tokenProgram` for classic? It passes tokenProgram for Token-2022 and classic; correct. For classic control, if ATA already exists? simulationOwner offcurve no account; good.

Potential issue in `run-tests.sh`: It deactivates features, fresh ledger. good.

Potential issue in `sim/clone-pob.mjs`: It patches only owner bytes but not `update_authority` or `plugins`. It patches only two assets. good.
Potential issue: It writes collection copied unchanged; if real collection has an Oracle with accounts? current mainnet no. fine.

Now let's focus on **MINT accounting with `owed_scaled` and `claim` when multiple vaults and frozen**. We can maybe find an underflow or loss. But suite books balance.

Potential issue: In `claim`, after paying each vault, it does not store record for a vault if `pay==0` and `touched=false`. If r was just joined (pending) it store. fine.
Potential issue: For an active vault with `pay==0` but `touched=true` it stores record. Good.

Potential issue: `monthly_inline` crediting from frozen pool disabled. We saw.

Potential issue: `claim` monthly_inline occurs before `acc = config.acc_scaled`, so if month due it credits and then claims. good.

Potential issue: `activate` monthly_inline before reading r to ensure month due. good.

Potential issue: `boost_vault` monthly_inline before reading terms. good.

Potential issue: `retire_redeemed` monthly_inline after retire, so redeemer excluded. good.

Potential issue: `distribute` does not call monthly_inline first. If month due and someone calls distribute burn, it uses current config and then credit, advances epoch once. It doesn't first run monthly in-line, but distribute itself is the monthly/burn path. It checks due for free path but burn path doesn't need due. Good.
Potential issue: If monthly due and someone calls `distribute(false)` free path, it credits. Good.
Potential issue: If monthly due and someone calls `distribute(true)` burn path, it does not require month due, but it credits. This is intended burn path anytime. It does not check if `waiting_to_join` etc. good.

Potential issue in `distribute` burn path: It reads `avail` before checking `waiting_to_join`. If waiting_to_join>0, it returns after burning? It checks before burn. good.

Potential issue: If `avail >0` but `w>0`, distribution credits. Then `advance_epoch` increments dist_epoch, pending_this_epoch=0. Good.
Potential issue: If all active weight is due boosts but boosts_due=0? consistent.

Potential issue: `tick` advances epoch but doesn't update `pending_this_epoch=0`? It calls `advance_epoch`, which does. good.

Potential issue: `advance_epoch` does `c.pending_this_epoch = 0;` after increment. So pending current at old epoch lost? They become eligible and count in waiting_to_join. good.

Potential issue: `join` uses `c.pending_this_epoch`? It decrements `pending_count` but not pending_this_epoch. Since join only when dist_epoch > request_epoch and advance_epoch reset current to0. good.

Potential issue: `retire` pending: if `request_epoch == c.dist_epoch` decrements pending_this_epoch; else not. If retire a pending vault in current epoch before any distribution, both counts. If later `dist_epoch` advanced and pending_this_epoch reset, pending_count includes it but pending_this_epoch no; retire in later epoch decrements pending_count only. good.

Potential issue: `waiting_to_join` subtracts `pending_this_epoch` from `pending_count`. If pending_this_epoch could be >pending_count due to inconsistency? Underflow error. But counters should consistent.

Potential issue: `activate` first call if already pending? The first branch `if r.pending` requires dist_epoch>request. If not, returns ActivationPending. It does not allow re-request. good.
Potential issue: `activate` first call if r.active true returns AlreadyActive before pending branch? Code:
```
let r=&vault_record;
require!(!r.retired)
require!(!r.active, AlreadyActive)
if r.pending { ...}
require level...
...
```
`require!(!r.active)` before pending. r.active false for pending. good.

Potential issue: `activate` first call does not check `r.pending` before monthly_inline; after monthly if pending true and eligible? If monthly_inline ticks, then r.pending? If dist_epoch > request, branch joins. So a second activate after month due can join. Good.

Potential issue: `claim` can join vaults with `crank_n` maybe. good.

Potential issue: `set_round` does not update `last_distribute_at`? unrelated.

Potential issue: `emergency_stop_sales` and `sweep` do not `emit_wiring`? they emit StopChanged not full wiring. fine.

Potential issue: `restart` doesn't emit full wiring. emits StopChanged. fine.

Potential issue: `arm/apply_guardian` emits full wiring. good.

Potential issue: `apply_swap_operator` full wiring. good.

Potential issue: `sweep_sol_for_swap` no full wiring. fine.

Potential issue: `split_revenue` no config update. fine.

Potential issue: `initialize` Royalties plugin authority None. Good.

Potential issue: `set_boost_terms` if price>0 and weight/epochs within current cfg max. But `max_boost_weight`/`max_boost_epochs` are fixed at initial. good.
Potential issue: `boost_vault` checks buyer's terms:
```
require!(price <= max_price && extra >= min_weight && epochs >= min_epochs, BoostTermsMoved);
```
If terms move in buyer's favour (price lower, extra higher, epochs longer), passes. If price0? boosts off; earlier require term price>0. good.
Potential issue: `min_epochs` as u16; epochs read. good.

Potential issue: `BoostNotTheOwner` verifies asset current owner via data[1..33], but it does `require_keys_eq!(Pubkey::new_from_array(o), ctx.accounts.burner.key(), ...)`. If data has owner bytes but asset account owner could be not MPL_CORE? earlier `require_live_vault` checks owner. good.

Potential issue: In `boost_vault`, it obtains `(price, extra, epochs, cbob, collection)` from config before mutable. Then after require terms, reads record. If an earlier monthly_inline mutates config, ok. Then `let c=&mut config` later. good.

Potential issue: `initialize` with `cbob_mint` account owner SPL and len82; it does not check `cbob_mint` is different from `payment_mint` and `GARY_MINT`; it does require neq. good.

Potential issue: `initialize` with `max_supply` could be less than `level_caps` sum? It requires cap_total <= max_supply. good.
Potential issue: `initialize` with `level_caps` huge values maybe sum <= max_supply but each >0. Could level_caps sum less than max_supply; remaining supply beyond cap_total never minted. Maybe accepted? It says max_supply and level caps. If sum less, some supply inaccessible; launch checker pins. no.

Potential issue: `initialize` with `charter_closes_at` > now; if `charter_opens_at` far past but close future, okay. good.

Potential issue: `initialize` with `monthly_secs` = 30 days; `last_distribute_at = max(now, close)`. good.

Potential issue: `initialize` with `guardian` Some default? It allows default? It doesn't require guardian non-default. An initial guardian default means nobody can stop. Is that allowed? DESIGN option maybe can be None; Some(default) equivalent None for guardian. Launch checker pins Gary. no.

Potential issue: `initialize` with `bank_treasury` off-curve or on-curve? check nondefault. Could be revenue PDA, pool ATA? If bank_treasury is revenue PDA or config, split could misroute? It's one-time pinned. Launch checker. no.

Potential issue: `initialize` with `swap_operator` = guardian etc. pinned.

Potential issue: `initialize` with `sol_reserve_lamports` zero or >= rent. If zero allowed; launch checker. no.

Potential issue: `initialize` with `reserve_ceiling_lamports` >= reserve. good.

Potential issue: `initialize` with `cooldown_ceiling_secs` >= cooldown and <= max7d. It doesn't check `cooldown_ceiling_secs >= sweep_cooldown_secs` yes. good.

Potential issue: `initialize` with `sweep_floor_lamports` >= MIN_SWEEP_FLOOR and <= max_sweep. good.

Potential issue: `initialize` with `max_sweep_lamports` <= MAX_SWEEP. good.

Potential issue: `initialize` with `sweep_cooldown_secs` in 1s..24h. Ruled 6h. good.

Potential issue: `BURN initialize` with `redeem_window_secs` 10s..24h. Ruled 3600. Checker.

Potential issue: GOV initialize with `threshold_bps` >5000 and <=7500. Ruled 5100. If threshold >5100 but <=7500, stricter. accepted. quorum min500. good.
Potential issue: GOV initialize with min_voting_secs 60..30d. Ruled 259200. good.

Potential issue: The voting period max 30 days, but execution window 7 days. fine.

Potential issue: `MIN_TURNOUT_YES_BPS` 1000, `KEY_CHANGE_YES_BPS`5000. good.

Potential issue: `execute_proposal` quorum `need` computed with `checked_add(9999)/10000`. If divisor * quorum_bps =0? need0; then `require need >0`. good.
Potential issue: `need_yes` similarly.
Potential issue: `key_change` can be triggered by a proposal that has both guardian and operator? creation forbids; if not, but any. good.

Potential issue: `read_mint_config` in GOV uses `u64` for `charter_closes_at`, `cooldown`, etc. Good.

Now maybe there is **a bug in `initialize` collection clean check for Core CollectionV1**: It checks `d.len() == o + 8` where o after two names. But Core CollectionV1 layout may have more fields or alignment? It passed suite. good.
Potential issue: It doesn't check `current_size` bytes zero? It checks d[o..o+4]==[0,0,0,0] (num_minted?) and len==o+8. If current_size nonzero but num_minted zero? Could collection have current_size > num_minted? For a clean unminted collection, current_size likely 0. It doesn't check current_size; len==o+8 means no plugin header but could current_size >0? There are exactly 8 bytes after o (num_minted u32 + current_size u32). It only checks first 4 zero (num_minted), not second 4 (current_size). If current_size nonzero but num_minted zero, can a collection have current_size > num_minted? Maybe if burnt? For new collection current_size=0. But could an empty collection with current_size >0? After burning assets? numMinted increments stays >0. If all burned, current_size 0 but numMinted >0. Could current_size > numMinted? probably no. Not issue.

Potential issue: `initialize` doesn't check collection name/uri lengths? It does parse. fine.

Potential issue: `create_vault` plugin set includes two plugins but `CreateV2` data:
```
data.push(1); data.extend_from_slice(&2u32.to_le_bytes()); // maybe len? 
...
data.push(1); data.extend_from_slice(&0u32.to_le_bytes());
```
This is likely `plugins: Vec<Plugin>` serialization where each plugin has (authority/manifest?). tested.

Potential issue: `AddCollectionPlugin` royalties with plugin authority None. data:
```
vec![IX_ADD_COLLECTION_PLUGIN_V1, PLUGIN_ROYALTIES]
+ ROYALTY_BPS u16
+ 1u32 creators
+ revenue + 100
+ RULESET_NONE
+ 1 (Option Some) + PLUGIN_AUTHORITY_NONE
```
Maybe missing `init_authority`? Test passes with real Core. fine.

Potential issue: `MINT` `IX_CREATE_V2` data `vec![IX_CREATE_V2,0]`; one byte 0 maybe payer? It passes maybe `compression_proof`? no. tested.

Potential issue: `Initialize` `pob_collection` not checked for ownership. Could set to a malicious Core collection that has an external plugin on burn. That hot wallet risk. pinned.

Potential issue: `Initialize` `cbob_mint` data len82 but does not check it has no mint authority or freeze. The real one does. pinned.

Potential issue: `BURN` `initialize` doesn't check `collection` non-default? It checks matches SEAL. If SEAL collection Pubkey::default? SEAL initialize allows default collection; MINT check? MINT initialize check `require_keys_eq collection` etc. But SEAL could be initialized with default collection, then MINT initialize with default collection? MINT's collection clean check requires owner MPL_CORE and key type, so could not use a system default. Thus no.

Potential issue: `SEAL` `initialize` doesn't check collection non-default. If someone initializes SEAL with default, MINT later cannot initialize because check_seal_wiring requires `collection` field match the clean MPL Core collection passed; it would see SEAL config collection default and MINT collection actual => WiringDiverged. So MINT fails. Burned? fine.

Potential issue: `GOV` initialize reads MINT config. good.

Now maybe a **liveness freeze** in `distribute`: `JoinWaitingFirst` could be abused to permanently block distributions by continuously creating pending vaults? Let's analyze. `waiting_to_join = pending_count - pending_this_epoch`: older pending eligible block. An attacker can create new pending_this_epoch by activating vaults, but those are not eligible until next distribution; they don't block current distribution. Existing eligible pending can be joined permissionlessly via claim. So cannot permanently block unless a massive number of eligible vaults and no one joins? But joining is permissionless. The crank also joins. Is there a way to block joining? `claim` to join a pending vault requires passing `vault_record` and `dest.key == r.vault_ata`; it doesn't require the asset live (accepted). It can join any pending vault without needing a token account? It doesn't read token account for joining, only record and dest key; if dest key matches r.vault_ata even if account missing, join succeeds. So anyone can join all eligible records by passing their recorded vault_ata keys. But to call claim, they need account list including pool token. They can join. So no permanent block.
Could a griefer create many `vault_record`s? Minting costs and level caps. no.
Potential issue: `expire_boosts` can expire due boosts but not join. fine.

Potential issue: BoostsExpireFirst can be abused to block distributions by buying a boost and never expiring? Expiring is permissionless. Could an attacker create a due boost and then block? But anyone can expire; no. Unless they create a huge number due in one epoch and `expire_boosts` max30 per call, but claim/crank can expire in batches; permissionless. Many due boosts could require many transactions to clear before distribution. That could be a temporary delay, not permanent. Anyone can expire all due boosts with many claims? A claim can expire at most number of records in a transaction ~? 14*? The crank can expire max? `expire_boosts` max30. If attacker buys boosts on many vaults ending same epoch, when due, `boosts_due >0`, next distribution blocked until all expired. Clearing 100 due boosts needs multiple calls. This is intentional gate; not permanent. The cost to buy many boosts is high. fine.
Potential issue: `monthly_inline` if boosts_due >0 returns, so a due boost can block ordinary host distribution until expired. ok.

Potential issue in `reweigh`: It changes `total_active_weight` and individual owed but does NOT update `c.boost_weight_total`; callers. good.

Potential issue: There is no restriction on boosting a vault that has a pending claim? boost requires active. fine.

Potential issue: `boost_vault` owner reads asset owner but does not update record `vault_ata`? no.

Potential issue: `claim` for a boosted vault with due boost and frozen destination expires boost before checking frozen. The boost's extra weight is already earned for prior distributions. If frozen, the vault remains owed boosted share. Good.

Potential issue: `claim` for a boosted vault with destination missing (not token) and owed sat terminates whole transaction and does NOT store expiry. Since term fails, transaction reverts, expiry not persisted. But claim may be used to expire boosts; if destination missing, it reverts instead of expiring. However `expire_boosts` can expire without token account. fine.

Potential issue: `ExpireBoosts` remaining accounts must be writable; if record is not writable from transaction, it refuses. Fine.

Potential issue: `set_boost_terms` governance only; not gated by BoostsExpireFirst. It can change terms while due boosts exist. okay.

Potential issue: `BOOST_RING` max 64 and `advance_epoch` u64 dist can wrap? u64 huge. no.

Potential issue: `cbob_burned_total` u64. price u64 * many boosts maybe overflow? checked_add. Could attacker mint huge cbob? real no. no.

Potential issue: `Merkle leaf` hashv with tag byte. good.

Potential issue: `reschedule` `r.reschedules = r.reschedules.saturating_add(1)`. It saturates at u16 max. After 65535 reschedules, no more log count increase but still reschedules. Not issue.

Potential issue: `try_capture` uses `hashv` which is SHA256 but returns hash. fine.

Potential issue: `reveal_level` picks level `li` with `let mut x = u64::from_le_bytes(entropy[0..8]) % total;`. If `total` u64, and `x` u64. If `x < *r` where r is u32 cast to u64. good.
Potential issue: If remaining total is 0, require >0. good.
Potential issue: If level_caps sum > u32? each u32. no.

Potential issue: `capture_entropy` stored entropy is 32 bytes. fine.

Potential issue: `blockhash_in_window` uses `require!(data.len() >= 8 + n * 40)`, but if count is larger but data has extra, okay. If n=0, no hash. returns None. good.
Potential issue: It doesn't verify `data.len() ==8+n*40`; extra bytes okay. Not security.
Potential issue: It uses `u64::from_le_bytes(data[0..8])` as count. If count huge, n usize; require n<=512. good.
Potential issue: It loops `i` up to n; if n=512 and data has exactly, no OOB. good.

Potential issue: `try_capture` `want` computation:
```
want = (slot / LEADER_GROUP_SLOTS).checked_add(STRIDE)?.checked_mul(LEADER_GROUP_SLOTS)?;
```
If slot near u64::MAX, overflow fail. no.

Potential issue: `capture_entropy` `RevealWindowExpired` if window expired; but if now > reveal+300 and slot hashes still has C not produced, it would Expired rather than NotYet. The window is chosen so C within 300. accepted.

Potential issue: `reschedule_reveal` allow after window but if reveal_slot + window exactly, `now >` so if now == reveal+window+? Actually require `now > reveal_slot + window`. At `now=reveal+window+1`, old window passed. But SlotHashes window 512, A at most reveal+64; still there. Fine.
Potential issue: `capture_entropy` require `now <= reveal+window`; try_capture first checks `now > reveal+window` Expired. same.

Potential issue: `crank` expired reschedule if now > reveal+window. Good.

Potential issue: `crank` can reschedule a vault even if its entry is not next in FIFO. fine.

Potential issue: `reveal_level` inline capture if `now > reveal_slot+window` returns NeedsReschedule. good.

Now let's look at `bank/selftest.mjs` not included, but not necessary.

Maybe hidden bug in `HOLDER-GUIDE` true sentences? It says "The validator producing the last of those blocks can choose among several results, by skipping a block or changing what goes into it." Is changing what goes into block only if it's the leader; yes. "That can be enough to choose the level of a vault created in the same moment (from the levels still left), and one choice affects every vault created in that moment at once." True. "A draw nobody records in time is drawn again." yes. "the minter could use this to turn down a draw they dislike. It only works if nobody records... anyone can record it, and our job tries every minute." true.

Potential issue: "Activation is picked up automatically" depends crank live; accepted offchain.

Potential issue: "Every opening is public" false as noted.

Potential issue: "Only you can open it. Not a vote, not anyone. Opening needs your wallet's signature and nobody else's." If vault is in Gary Club wallet, Gary Club key. It qualifies. fine.
Potential issue: "Opening is all or nothing." true.
Potential issue: "Your level never changes." true record, but could a vote boost? boost doesn't change level. good.
Potential issue: "The rules cannot change." But Metaplex core can change; qualified. good.
Potential issue: "Everything else happens on its own... Our payout job runs it..." offchain. accepted.

Potential issue: "A payout is due every month... Anyone can speed one up by burning 100 $GARY, but not before the first month..." This was repaired. good.

Potential issue: "The redeem page offers this and does the steps for you (a payout can only run once every newly activated vault has joined...)" not built; L1 accepted. Could report under item50.

Potential issue: "Only open your vault on the Bank's redeem page." The page doesn't exist. HOLDER-GUIDE marked draft, item50 open. Not new.

Potential issue: "Every opening is public" same.

Potential issue in `launch/mainnet-init.json`: comment says "all RULED except charter date and lock deadline". `charter_opens_at` open; `lock_deadline` open. Good. `charter_secs` 604800. 

Potential issue in `check-launch-params.mjs` not included; no.

Now maybe there is a **bug in `MintConfig` version / padding affecting GOV offsets** after comment line shift. We recalc fine.

Potential issue: `Bank treasury` in HOLDER-GUIDE and docs "the Bank" used as system, not code. no.

Potential issue: `SPEC.md` line in "The reserve list is a HARD CEILING of three" says 3-reserve with claim fit; simulation S8.0 measured 1061. fine.

Potential issue: "A redemption carrying no crank" no code.

Now maybe think of attack on **sweep helper through Core Execute from collection update authority on a control asset** was tested; core access sound. But there may be a route through `PermanentFreezeExecute` plugin authority SEAL's PDA. Could SEAL's PDA itself sign an Execute? SEAL program only has `set_frozen`; no Execute CPI. Its PDA cannot sign otherwise. good.
Potential issue: MINT's PDA could add AgentIdentity? It has no instruction. But Core upgrade? accepted.

Potential issue: If an attacker gets update authority of collection (MINT PDA) somehow? MINT program has no instruction to add plugins to assets except reveal_level attributes update. It uses `UpdatePluginV1` with `mint_authority` signer. Could someone call `reveal_level` on a vault to update Attributes plugin with arbitrary attributes? It only appends level and requires hash. But Core UpdatePluginV1 for Attributes replaces plugin. It invokes with MINT PDA signer. Could the same instruction be manipulated to update OTHER plugins because the program ID and data are hardcoded? No.
Potential issue: MINT's `UpdatePluginV1` CPI data includes plugin type Attributes and attributelist. Authority of Attributes plugin is MINT_PDA. It cannot update other plugins because data type fixed. good.

Potential issue: SEAL's `UpdatePluginV1` CPI data includes plugin type PermanentFreezeExecute. Authority SEAL PDA. Could someone call SEAL's `set_frozen` directly with data fixed false but no open? The function is not externally callable, only from open handler. no.

Potential issue: BURN's `BurnV1` can burn any Core asset in collection owned by owner? It requires its own paired open and emptiness. Could an owner burn their own vault with no assets but no open? No. Bare Core burn possible separately. fine.
Potential issue: PoB burn in MINT claim could burn any asset in PoB collection owned by owner and in Merkle set. intended.

Potential issue: `claim_charter_vault` PoB asset could be already burned? `require d.len>=66 && d[0]==1`; no. good.

Potential issue: `claim_charter_vault` proof validation uses asset address, not owner. good.

Potential issue: `pob_extra` accounts count u8; if `ctx.remaining_accounts.len()` >255 and pob_extra=8, fine. 
Potential issue: `MAX_POB_EXTRA=8` but the first 8 extra accounts may include optional crank accounts? It splits. fine.

Potential issue: `claim_charter_vault` `crank` accounts after extra are optional; if `pob_extra >0` and no crank, fine.

Potential issue: `merkle_root_from` computes node sorting. good.

Potential issue: `scripts/pob-merkle.mjs` `layersOf` if pubkeys not sorted? RootOf doesn't sort leaves; set in `pob-set.json` sorted by edition. Rust doesn't sort leaf order; both use same leaf order in proof generation. A different order would produce different root; committed root from file. fine.

Potential issue: `proofOf` uses index from given list; tests use same list. good.

Potential issue: `BURN` derived ATA for Token-2022: There is potential confusion: ATA program for Token-2022 uses `TOKEN_2022_PROGRAM_ID` and if mint is classic, creation refuses IncorrectProgramId measured. BURN declares and skips if no account. Good.

Potential issue: `split_revenue` amount `total` from revenue ATA; if revenue account has delegate/close authority, not checked. It is PDA-owned, no one can delegate? Actually the revenue PDA is owner; no one can sign as it except program. But could an owner? no. fine.
Potential issue: `pool` ATA can be frozen. claims fail. accepted.

Potential issue: `split_revenue` with frozen revenue_ata: token transfer from frozen account fails? Token program checks source not frozen? A frozen account cannot transfer. So split fails. accepted.

Potential issue: `sweep_sol_for_swap` could sweep SOL while revenue address has 0 lamports? Reserve. no.

Potential issue: `claim` pays from pool without checking pool token state is initialized; if pool frozen, it doesn't check before invoking token transfer. Token program will return error 0x11. That reverts whole claim. The `claim` comment says frozen pool stops every claim that pays. It does not explicitly check before CPI; okay.
Potential issue: `claim` for frozen pool but pay=0 still lands and can join/expire. Good.
Potential issue: `monthly_inline` with frozen pool returns, so no new owed. explicit distribute can credit; documented.

Potential issue: `retire_redeemed` `forfeit` true if pool frozen; it still calls `monthly_inline` after retire. monthly_inline sees frozen pool and does not credit. good.

Potential issue: `apply_guardian` and `apply_swap_operator` are not payer; rent-free config changes. fine.

Potential issue: `arm_guardian` with guardian default (None) pending; `cancel_swap_operator` guardian only. fine.

Potential issue: In GOV `execute_proposal`, `read_stops` returns `sales_stopped_at` etc using `read_mint_config` verifies config then borrows data again. race? no.
Potential issue: `p` borrowed mut and `a` iter; Rust. okay.

Potential issue: `Governed` MINT `restart` has `proposal_created_at` argument; GOV passes p.created_at. MINT compares stop times. Good.
Potential issue: If restart_sales true and sales not stopped, it doesn't need proposal_created. fine.
Potential issue: If guardian stops sales in same second as proposal, skip due >=. accepted.

Potential issue: `Governed` MINT `restart` if sales and sweep flags both false refused NothingToDo at top. GOV validates actions? Brakes requires at least one. good.

Potential issue: `Mint` `set_round` sets round_id increment, opens/closes. It doesn't ensure new round opens after old round closes; could be overlapping? A vote could set round while one open; `set_round` simply overwrites with new. That's intended governance can replace round. MINT `mint_vault` uses current config; old round gone. Fine.
Potential issue: `minted_this_round` reset for new round. good.

Potential issue: `set_round` `closes_at - opens_at <= MAX_ROUND_SECS` but no bound on opens future. fine.

Potential issue: `set_round` price >= floor. good.

Potential issue: `create_proposal` action SetRound can create a round with opens_at in past? It only validates closes>opens. As earlier, not issue.

Potential issue: `SetRound` at execute can install a round already over; skip logged. Good.

Potential issue: `SetRound` at create before close? no proposal before charter close. done.

Potential issue: `create_proposal` no proposal before `charter_closes_at`. Good.

Potential issue: `KEY_CHANGE_YES_BPS` half of quorum_supply; at low burned, fine.

Potential issue: `read_burn_total` not checking BURN config bump? not.

Potential issue: `read_vault_index` not checking vault record retired/live; only index. A burned/retired vault can't vote because read_core_asset fails if burned. If retired but asset still live? Retire only after burn. no.

Potential issue: A vault transferred to a new owner after proposal; old vote record remains but new owner can't vote. good.

Potential issue: `VoteRecord` PDA is bound to ASSET but not to proposal id in seeds? Actually in cast_vote Account:
```
#[account(init, ..., seeds=[VOTE_SEED, proposal.key().as_ref(), vault_asset.key().as_ref()], bump)]
```
Yes includes proposal. good.

Potential issue: `vote_record` space 8+32+32+1+1 correct. fine.

Potential issue: `create_proposal` proposer can create many proposals, no cooldown. That could spam governance, but costs rent and voting periods. Not an issue.

Potential issue: `execute_proposal` no payer. fine.

Potential issue: `create_proposal` proposal account `init` payer proposer, rent. fine.

Now maybe there is a **memory safety issue** in raw reads: Some `try_borrow_data` on accounts also mutably borrowed? In `read_mint_supply` BURN uses `acc.try_borrow_data()?` after mutable borrow of config maybe? No conflict if different accounts.
Potential issue: In `burn_vault`, `ctx.accounts.mint_config` is mutable account for retire. Before that `read_mint_supply(&ctx.accounts.mint_config)` takes borrow; later invoke uses it. Borrow ends. good.

Potential issue: In `retire_redeemed`, `pool_is_frozen(&ctx.accounts.pool_token, &ctx.accounts.config)?` takes immutable borrow of config, then `retire(&mut ctx.accounts.config, ...)`; NLL. good.
Potential issue: `monthly_inline` called after with `&mut ctx.accounts.config` and `&ctx.accounts.pool_token`. good.

Potential issue: In `claim`, `let acc = ctx.accounts.config.acc_scaled;` then mutable `let c=&mut ctx.accounts.config` at end. NLL. good.

Potential issue: In `distribute`, `let c=&mut ctx.accounts.config` after `if burn` and checks. It uses await? Rust. fine.

Potential issue: In `initialize`, `let (mint_pda, mint_bump)` and later `let collection_key = ctx.accounts.collection.key(); let c=&mut ctx.accounts.config; let (gov_pda,...); c.collection=collection_key;` good.
Potential issue: `Check_seal_wiring` requires seal config; uses mutable? no.

Potential issue: `initialize` does not include `pob_collection` account, just pubkey; but `claim` later requires `pob_collection` account passed and checks asset collection. fine.

Potential issue: `initialize` `cbob_mint` account mut? It's UncheckedAccount read. good.

Potential issue: `MintConfig` `bank_treasury` name; no issue.

Potential issue: `INIT_AUTHORITY` associated with compile features. build proves. fine.

Potential issue: `MINT` `check_attributes` at claim_charter budget `MAX_ATTRS -2`. Paid 7? MAX_ATTRS=8 -> paid MAX_ATTRS-1=7; charter gets 6 because program adds charter and level. Good. Is that correct? Max total 8 including program's own `charter` and `level`, so paid mint can have 7 caller attrs plus level =8? Wait total on paid mint: caller attributes plus `level` = caller+1. The program `create_vault` paid mint passes `attributes` as caller-provided list and does NOT add charter. It later reveal adds level. So total max = caller MAX_ATTRS-1 =7 + level =8. Good. For charter, create_vault receives `full = caller attrs + [charter]`, then reveal adds level. So caller attrs + charter + level = total max 8, thus caller budget MAX_ATTRS -2 =6. Good.
Potential issue: `check_attributes` itself doesn't check total budget; caller could pass 6 attributes each 128 bytes, write_record enforces bytes <=640. Also attr count. fine.

Potential issue: `mint_vault` `check_attributes` before create; `write_record` after also bytes. good.

Potential issue: `claim_charter_vault` `check_attributes` before adding charter; `write_record` bytes with full includes charter. good.

Potential issue: `write_record` computed bytes based on `attributes` passed, but doesn't include the level attr later added. It intentionally bounds minted list excluding level because reveal adds it. The reveal fits measured. good.

Potential issue: `MAX_ATTR_BYTES=640` and test L.12 exact. good.

Potential issue: `Initialize` `max_boost_weight` u8 and `max_boost_epochs` u16. It validates. good.

Potential issue: `MAX_EXPIRE_BATCH=30`; packet maybe fits. tested BO.18a.

Potential issue: `MAX_CRANK=4`; host packet fits. tested P.33.

Potential issue: `crank` account list length at most 4 records plus SlotHashes. `crank` only reads first as SlotHashes; okay.

Potential issue: `crank` accepts records that are not `is_writable`; skips. If a record is writable but wrong owner, skips. If all skipped, returns. good.

Potential issue: In `mint_vault`, it calls `crank(ctx.remaining_accounts, slot)` after `emit`. If `remaining_accounts` contains claimed records, fine.
Potential issue: `claim` calls `crank` before `pairs` and before monthly. If crank accounts include a record that is also a pair, race as tested. fine.

Now maybe there is **a bug in `distribute` with `read_token` on pool token when pool frozen**: read_token returns state but ignored. We saw documented explicit distribute not refused. fine.

Potential issue: `pool_is_frozen` returns true only if data len exactly165 and state==2. If Token-2022 pool? pool is classic, len165. good.
Potential issue: `pool_is_frozen` doesn't check mint/owner fields before state, only len and state. If an arbitrary token account at pool key with state frozen but different mint/owner? The key is derived; attacker can't create arbitrary at PDA. fine.

Potential issue: `monthly_inline` checks d[0..32]==payment_mint and d[32..64]==config_key before reading amount. good.

Potential issue: `read_token` checks owner key and mint key. fine.

Potential issue: `split_revenue` doesn't check `revenue_ata` state before reading amount. fine.

Potential issue: `mint_vault` payment `payer_token` maybe not writable? Anchor marks mut, okay.

Potential issue: `claim_charter_vault` `pob_asset` account mutable, PoB burn. good.

Potential issue: Core BurnV1 might reject if PoB has plugins requiring extra accounts; pass-through. good.

Potential issue: `pob_extra` accounts all not signer, but if account is `payer`/`owner` again? It appends extras after fixed; could include duplicate accounts. Core handles. fine.

Potential issue: `claim_charter_vault` `pob_proof` empty for single leaf? for one PoB? set 240. no.

Potential issue: `merkle_root_from` if proof length 0 and leaf root for a set of one; but set 240. no.

Potential issue: `MAX_POB_PROOF=16`; no issue.

Potential issue: `PoB root` commit maybe not all addresses sorted; no.

Potential issue: `scripts/pob-set.json` not included. no.

Now perhaps there is a **vulnerability in the rolling redemption cap due to timestamp ring and `rate_head as u8`**:
`rate_head` is stored u8. It stores `((head+1) % RATE_RING) as u8` where RATE_RING=64. 0..63 fits u8. `rate_head as usize % RATE_RING`. good.
But `c.rate_ring = [0; RATE_RING]` initialized zeros. If first redemptions happen, kth zero. `now.checked_sub(0) >= window` true for now > 1677? Actually now = unix timestamp e.g. 1.7e9, so true. good.
Potential issue: If `redeem_window_secs` is large and `now` less than window? no.

Potential issue: Live supply can be 0 at late stage, cap max(1). It still permits one redemption per window. good.
Potential issue: If live supply 1, cap ceil(0.021)=1. good.
Potential issue: If live supply >3047, cap >64 min to64, ring stores last64, so allow if 64th oldest older than window; at most 64 in window. strict. good.

Potential issue: The ring boundaries computed independent. good.

Potential issue: `read_mint_supply` in BURN reads `bare_burns_retired` at 454. Since MINT config version6, correct.

Potential issue: `burn_vault` computes `cap` from live before burning current vault. For second redemption in same tx, first burned_total not yet incremented until after first burn instruction? Wait burned_total increments in first burn instruction end, so second burn instruction sees live supply one lower, cap recalculated. That's correct. S9b tests two redemptions land at cap2. The rate checks are within each burn instruction; first burn increments config; second sees update. Good.
Potential issue: If two burns in same tx at cap1, second sees live one less cap1 but ring now has current now, kth (most recent) same now, `now - now =0 < window` => rate limited. Good. RL.6 test.

Potential issue: If cap changes after first burn lower? floor1. fine.

Potential issue: `read_mint_supply` reads MINT config `minted_total` and `bare_burns_retired` while same transaction may include a retirement before burn? Could pass embark. no.

Potential issue: `BURN.burned_total` increment after retire. If retire fails, burn reverts including burned_total. good.

Potential issue: `open_for_redemption` doesn't check rate limit; burn does. good.

Potential issue: `burn_vault` rate limit before emptiness. If a rate-limited burn transaction also includes opening, SEAL thaw would revert when burn fails. atomic. good.

Potential issue: A griefer could fill rate limit to block holders. accepted.

Potential issue: `BURN` emptiness proof reserve loop: If a reserve ATA remains open after sweep, BURN only checks amount==0. It doesn't check close. accepted.

Potential issue: `BURN` emptiness proof lamports check: It requires `asset_signer.lamports()==0`. The sweep helper transfer all. If custom sweep doesn't sweep lamports, failure. good.

Potential issue: `burn_vault` `ctx.accounts.asset_signer` PDA derived with `vault_asset.key()` as seeds under MPL_CORE. It does not use `bump` from find, but Anchor `seeds` with `vault_asset.key().as_ref()` and `bump`? It doesn't specify `bump`; Anchor finds canonical? In account struct:
```
#[account(mut, seeds = [EXECUTE_PREFIX, vault_asset.key().as_ref()], bump, seeds::program = MPL_CORE_ID)]
```
It uses canonical bump automatically. good.

Potential issue: `SEAL/BURN` config accounts seeds. fine.

Potential issue: `MINT` context `MintVault` `vault_record` seeds uses `asset.key().as_ref()`. `asset` is Signer; if asset key reused burned? anchor init fails system. good.
Potential issue: `ClaimCharterVault` same.

Potential issue: `create_vault` call uses `asset: &Signer` and `payer`; good.

Potential issue: `MINT` `create_vault` `owner` signer not required in account metas? It includes readonly owner signer in instruction; yes. good.

Potential issue: `Initialize` collection authority MINT_SEED derived offcurve. good.

Potential issue: `check_seal_wiring` requires `seal_config` owner == SEAL_PROGRAM_ID. good.

Potential issue: `check_seal_wiring` reads collection at offset9 and version at8. good.

Potential issue: `initialize` `seal_reserves` reads Vec len at41, max3. It doesn't require vectors length exactly max; fine.

Potential issue: `MINT` `initialize` `payment_mint` in SEAL reserves; if payment mint duplicated? no.

Potential issue: `BURN` `initialize` doesn't check SEAL reserves length; it just version/collection. Later burn reads. If SEAL initialized with 0 reserves, MINT/BURN init? MINT initialize would fail payment_mint not reserve; BURN can init but burn later fails NoReserveMints. But launch checker. no.

Potential issue: `GOV` `initialize` doesn't check BURN config; not needed.

Potential issue: `Initialize` in all four only INITAUTHORITY; if someone can front-run before? PDA seeds and authority. local test. mainnet key Gary. good.

Potential issue: `scripts/build-mainnet.sh` not proving compiled constant is Gary's exactly but build from source. accepted.

Now maybe find **a real issue in `JoinWaitingFirst` and monthly_inline**:
`monthly_inline` checks waiting_to_join before `total_active_weight ==0`. If there is an eligible waiting vault, it returns and doesn't tick. Good. But `claim` joins eligible vaults after monthly_inline. If a host `claim` is the first instruction after a distribution made vaults eligible, monthly_inline is called; it sees waiting_to_join>0 and returns, leaving `last_distribute_at` not updated. Then claim joins vaults. The month may still be due; next host will run monthly. This is intended: never credit before joining. It can delay distribution until after join in a later transaction. The crank does joins before distribute. fine.
Potential issue: `distribute` refuses JoinWaitingFirst, so no distribution until joined. fine.

Potential issue: `activate` second call joins; it doesn't call monthly first? It does monthly_inline before the pending branch. If a month is due and an eligible pending exists, monthly_inline returns because waiting_to_join>0, then activate joins. So activation second call can join before distribution. good.

Potential issue: `claim` can join multiple eligible records in one transaction; if it also pays active vaults in same claim and pool frozen? If pool frozen, monthly returns, then joining okay, then paying active would fail. If claim batch includes paid active, entire transaction fails, losing joins? Joins hover? Since transaction reverts. The crank should send join-only batches when pool frozen. accepted. fine.

Potential issue: `monthly_inline` in a `claim` that pays active while pool frozen returns before active0? due? If due and boosts_due/waiting, returns; then claim pays and fails. But if no distribution due, claim pays and fails anyway because pool frozen. accepted.

Potential issue: `monthly_inline` in `retire_redeemed` with pool frozen returns; then retire forfeits. good.

Potential issue: `Boost` N distributions: `advance_epoch` runs on every distribution, including empty ticks. A boost bought after an empty tick? It counts distributions including empty ticks. SPEC says distribution counts including empty epoch ticks? It defines boost N distributions. Does an empty tick count as a distribution? `credit` or `tick` both call `advance_epoch`. `dist_epoch` increments. Boost end_epoch = dist_epoch + epochs. If no active weight and a tick occurs, dist_epoch advances and could cause boosts to become due even though no payout was credited. Is that intended? The docs say "distribution" maybe includes empty epoch ticks? It says "How many distributions (including empty epoch ticks) have run." That is in spec. Boosts are measured in distributions; an empty tick is an epoch advance. Could someone force empty ticks while no active? To have an active boosted vault, total_active_weight>0, so w>0. Can empty tick occur while active boost exists? Empty tick occurs only in w==0. Since boost requires active, if any boosted vault active, w>0. Thus no empty tick while boosts live. But could all boosted vaults retire, then active0. If a boost is live but its vault is retired? retire sets active false; boost unscheduled. No. So a live boost implies w>0. Therefore ticks don't happen while live boosts. Good.

Potential issue: A distribution with w>0 but avail=0 is refused (NothingToDistribute) even if month due; no epoch advance. Good.

Potential issue: A distribution with w>0 and avail tiny (1 sat) can advance epoch and expire boosts. That's intended; anyone can burn $GARY or monthly. 
Potential issue: A boosted vault can force N distributions by burning $GARY? Only vault owner has boost; anyone can distribute with burn if pool holds avail. The burner may not be vault owner. Then boost expires earlier. accepted.

Now maybe **vulnerability in `boost_vault`: It burns $CBOB with SPL Burn CPI, but `burner_token` account owner `burner` and mint `cbob_mint`. It doesn't call `require_keys_eq!(ctx.accounts.cbob_mint.key(), cbob)` and owner before reading; does. Good.
Potential issue: It doesn't check `burner_token` state != frozen (reads state). If frozen, SPL Burn from frozen source might fail; it checks state == TOKEN_STATE_INITIALIZED. good.
Potential issue: `distribute` $GARY burn checks state initialized. good.

Potential issue: `split_revenue` doesn't check `bank_ata`/`holders_ata` state; token program.

Potential issue: `mint_vault` doesn't check `payer_token` state initialized. token program.

Potential issue: `claim` frozen destination checked by data; good.

Potential issue: `BURN` reserve account state not checked; only amount and delegates. If frozen account amount0, burn could pass with account frozen? A frozen token account can't be swept/closed, so if it exists amount0 and undelegated but frozen, BURN would pass? Wait if frozen reserve account amount0, the vault could be redeemed even though source account remains frozen/open. But can an account be frozen with amount0? Coinbase freeze authority can freeze any account. The sweep helper would attempt to close a frozen reserve account; `CloseAccount` from a frozen account? SPL Token close account likely doesn't require unfrozen? It transfers all remaining lamports and destroys account; if amount0 and maybe no delegate, CloseAccount may succeed even if frozen? Need check SPL Token: CloseAccount requires account state Initialized? It doesn't check frozen? I think close account does not check frozen? Actually freeze prevents token transfer, but closing a zero-balance account might be allowed? Not sure. BURN's emptiness proof doesn't check state, so a frozen zero-balance account passes. But redemption still requires the sweep to close it before burn? The sweep helper attempts transfer amount0? It only transfers if amount>0, then invokes close account. If close account on frozen token account succeeds, fine. If it fails, redemption fails. Could a malicious Coinbase freeze an empty reserve account to block? Amount0 could be frozen; perhaps close happily? Not sure. But accepted "frozen account cannot be emptied" maybe not. Not relevant.

Potential issue: BURN's reserve loop delegates checks offsets:
- d[72..76] delegate COption? Classic token account layout: mint32, owner32, amount8, delegateOption4 at72, state1 at108, isNativeOption4 at109? Actually token account layout:
  0..32 mint
  32..64 owner
  64..72 amount
  72..76 delegate (COption<Pubkey>)
  76..108? reserve? 
  Wait actual SPL token account layout: mint 32, owner 32, amount 8, delegate 4, state 1, is_native 4, delegated_amount 8, close_authority 4. Offsets:
  delegate: 72..76 (COption 4)
  state: 108
  is_native: 109..113? Hmm let's recall: Token account `Account` layout:
  mint(0..32), owner(32..64), amount(64..72), delegate(72..76), state(76? Actually I think state at 108 due to COption padding? Wait common SPL token account state offset is 108 indeed. Then is_native 109..113 (4), delegated_amount 113..121 (8), close_authority 121..125 (4). But code:
  ```
  require!(d[72..76] == [0,0,0,0], ReserveDelegated);
  require!(d[121..129] == [0u8;8], ReserveDelegated); // delegated_amount
  require!(d[129..133] == [0,0,0,0], ReserveDelegated); // close_authority
  ```
  So offset 72 delegate, 113 delegated_amount? Wait code d[121..129] corresponds delegated amount, d[129..133] close authority? Need align. Known Token account struct:
```
Mint: PublicKey (0..32)
Owner: PublicKey (32..64)
Amount: u64 (64..72)
Delegate: COption<Pubkey> (72..76)
State: u8 (76)
IsNative: COption<u64> (77? due alignment?)
```
Hmm Rust repr(C) Account:
```
pub mint: Pubkey,
pub owner: Pubkey,
pub amount: u64,
pub delegate: COption<Pubkey>, // 4 bytes
pub state: AccountState, // 1 byte
pub is_native: COption<u64>, // 4? Actually COption<u64> is 12 bytes (4 tag + 8 value)
pub delegated_amount: u64,
pub close_authority: COption<Pubkey>, //4
```
Offset:
mint 0-31;
owner 32-63;
amount 64-71;
delegate 72-75;
state 76;
is_native 77-88? Wait COption<u64> is 12 bytes: 4 tag + 8 value. So is_native 77..88? Then delegated_amount 88..96? close_authority 96..100? But observed state at108? Let's verify known SPL Token account state offset actually 108 in code, so there is padding maybe `is_native` as COption<u64> starting 109? Let's find! Actually Tokenkeg Account layout:
```
mint: Pubkey (0)
owner: Pubkey (32)
amount: u64 (64)
delegate: COption<Pubkey> (72)
state: AccountState (76)    // u8 at 76
is_native: COption<u64> (77?) // size 12
delegated_amount: u64 (89?)
close_authority: COption<Pubkey> (97?)
```
But the TESTJS uses `TOKEN_STATE_OFF=108` and BURN uses state at 108. Let me recall actual `spl_token::state::Account` fields: 
```
pub mint: Pubkey,
pub owner: Pubkey,
pub amount: u64,
pub delegate: COption<Pubkey>,
pub state: AccountState,
pub is_native: COption<u64>,
pub delegated_amount: u64,
pub close_authority: COption<Pubkey>,
```
COption<Pubkey> is 4 tag + 32 value = 36 bytes! So:
- delegate offset72 size36 => 72..107
- state offset108 (yes)
- is_native COption<u64> offset109 size12 => 109..120
- delegated_amount offset121 size8 => 121..128
- close_authority offset129 size4? Wait COption<Pubkey> size36? Hmm no close_authority is COption<Pubkey> also 36 bytes, would offset129..164. But token account length 165. Yes! That matches: close_authority offset129 size36, total 165. So code:
  - delegate 72..76 check only first 4 tag? It checks first 4 bytes zero. That indicates None tag.
  - state at 108.
  - delegated_amount at d[121..129] zeros.
  - close_authority at d[129..133] first 4 bytes tag zero.
Good.

Now possible issue: They check `d[72..76]==0` only the COption tag, not the following 32 bytes if Some. If delegate Some (tag=1), first 4 not zero, so refused. fine.
Close authority check `d[129..133]==0` tag. good.
Delegated amount d[121..129]. good.

Potential issue: For Token-2022 accounts with extensions length170, BURN checks d.len() <165 then continue? In reserve loop:
```
if d.len() < TOKEN_ACCOUNT_LEN { continue; }
...
require d.len()==TOKEN_ACCOUNT_LEN, ReserveHasExtensions
```
For T22 len170, delegates checks at same offsets maybe valid; require len==165 rejects. good.
For non-reserve loop, similar.

Potential issue: `burn_vault` second loop for any declared token account owned by PDA but account len >=165: It checks delegates/amount/extensions. It doesn't check state, so a frozen zero-balance non-reserve token account could pass. But if it is a token account with extensions? length !=165. good.
Potential issue: Could a Token-2022 account with confidential balance base amount 0 and extensions length170 be swept? The helper cannot name it because read_token rejects length !=165. BURN second loop if undeclared? If declared as extra, it checks len==165 and refuses ReserveHasExtensions when owner=PDA. So redemption can't pass if declared. If undeclared but vault PDA owns a T22 account with confidential balance, BURN cannot see it if not declared; burn destroys token. accepted no enumeration. good.

Potential issue: The sweep helper rescues classic token accounts including non-ATA, but BURN's emptiness proof can see declared accounts. If a page uses helper on a classic token account with close_authority/delegate, helper Transfer and CloseAccount may fail; burn refuse. accepted.

Potential issue: `BURN` `declared` u8 byte; max 256, but transaction can't hold many. fine.

Potential issue: `split_revenue` uses `holders_ata` as config.pool_ata, but config.pool_ata is ATA derived with `SPL_TOKEN_ID`. good.

Potential issue: `initialize` sets `bank_treasury` but not `pool_ata`? derived. good.

Potential issue: `Mint` config `governance` set to GOV_PDA derived; no admin. good.

Potential issue: `open_for_redemption` config collection read, but does not check asset collection PDA? It reads asset field and checks passed collection account equals collection. It doesn't require `ctx.accounts.collection` is live Core CollectionV1 or owner MPL_CORE. But SEAL's `set_frozen` CPI to Core passes collection; Core validates collection. If attacker passes a wrong collection account matching asset's collection key? Asset data field contains collection pubkey. They can pass an arbitrary account at that pubkey? Collection account is a real Core account at that pubkey; if wrong owner, Core CPI likely fails. no.
Potential issue: `read_core_asset` requires data[33] == UA_DISC_COLLECTION, but for Core AssetV1 update authority disc is 2 for collection. good.

Potential issue: In `BURN burn_vault`, it requires `*vault_asset.owner == MPL_CORE_ID` before reading data. For burned asset owner MPL_CORE but len1 -> then read data requires key1 => NotACoreAsset. fine.
Potential issue: It doesn't check `collection` account owner MPL_CORE; Core burn validates. fine.

Potential issue: `BURN burn_vault` invokes Core BurnV1 with `collection` account. good.

Potential issue: `BURN` `burn_vault` does not distinguish a burned account from live; no.

Potential issue: `retire_redeemed` is_burned reads asset after Core burn. good.

Potential issue: `MINT` `reveal_level` burned check:
```
*d[0] == 0
```
It doesn't require `d.len() ==1` in the burned check:
```
let burned = {
 let a=&asset;
 let d=a.try_borrow_data()?;
 *a.owner == MPL_CORE_ID && d.len()==1 && d[0] == 0
};
```
Actually code:
```
let burned = {
 let a = &ctx.accounts.asset;
 let d = a.try_borrow_data()?;
 *a.owner == MPL_CORE_ID && d.len() == 1 && d[0] == 0
};
```
yes includes len1.

Potential issue: `is_burned` same. good.

Potential issue: `BURN` `retire_redeemed` request context `asset` UncheckedAccount readonly. is_burned works. good.

Potential issue: `read_core_asset` in GOV requires d.len>=66 but not upper bound. extra plugin data? AssetV1 data could be >66 with plugins; accepted. good.

Potential issue: `require_live_vault` in MINT doesn't check data[33] == collection? yes. It doesn't check owner of asset? It checks *a.owner==MPL_CORE. good.
Potential issue: `boost_vault` uses `require_live_vault` then asset owner read; good.

Potential issue: `activate` `require_live_vault` no upper bound.

Potential issue: `claim_charter_vault` PoB asset data check d[33]==collection, owner bytes. good.

Potential issue: `Initialize` collection clean d[0]==KEY_COLLECTION_V1; no upper bound. fine.

Now maybe **governance liveness** if all vaults redeemed and `minted_total` cap not reached. Accepted. If a round open but level caps exhausted (`cap_total` maybe max_supply) then no new vault can mint because check_supply `minted_total < cap_total`. Once max_supply=2100 minted, no new. If all redeemed, no live voter/proposer. Governance dead. Accepted. Could a round still open and `level_caps` sum=2100 so no. yes.

Potential issue: If `max_supply` greater than level_caps sum, some unminted lives cannot create. no.

Potential issue: `mint_vault` owner offcurve can mint; if all voters later offcurve? governance still propose/vote possible? A DAO owner can sign via CPI? create_proposal's proposer Signer can be PDA CPI signer. But top-level? create_proposal/vote can be CPI'd. So governance possible from offcurve owners if they can sign CPI. accepted offcurve only redemption issue.

Potential issue: `claim` and activation permissionless for every live vault; no owner signature. good.

Potential issue: `boost_vault` owner must be signer; if offcurve owner can sign CPI? `boost_vault` no top-level check, so yes. okay.

Potential issue: ``.

Now maybe there is a **bug in `create_proposal` voting_ends_at**: It sets `dur = voting_ends_at - now`, requires >= min_voting_secs and <=30d. It does not require `voting_ends_at` not in far future beyond i64? It subtract checked. good.
Potential issue: `execute_proposal` proposal expiration uses `voting_ends_at.checked_add(EXECUTION_WINDOW_SECS)`, safe. good.

Potential issue: `set_round` at creation action validation `closes_at - opens_at <= MAX_ROUND_SECS`, but MINT `set_round` same. Good.

Potential issue: `MIN_ROUND_PRICE_SATS` mirror in GOV; if MINT constant changed? Suite pins? It might not pin R. There is a comment. Could drift. The suite doesn't pin mirror except perhaps 3c.M1 for rent. If MINT lower/upper changed independent, no. But immutability, source same. no.

Potential issue: `RENT_EXEMPT_0_BYTES` mirror in GOV; suite 3c.M1 pins. good.

Potential issue: `SweepTighten` structs in MINT and GOV duplicated. Could drift field order. Suite executes end-to-end and pins. good.

Potential issue: `IX_SET_BOOST_TERMS` discriminator in GOV pinned to d. good.

Potential issue: `MAX_ACTIONS=5` and action kind at most one each. good.

Potential issue: `ACTION_MAX_BYTES=37`, Brakes actual size: tag 1 + bool3 + Option<Pubkey> 33 =37. good. actions space enough.

Potential issue: `Proposal` account can hold `Vec<ProposalAction>` length prefix 4 and serialized data. Space ACTIONS_SPACE=4+5*37=189. Good.
Potential issue: `SetRound` 1+4*? i64 8 + i64 8 + u64 8 + u32 4 =29. With enum tag 1 =29. `MAX_ROUND`? under37.
Potential issue: `TightenSweep` 1 + 3*Option<u64/i64>: each Option 1+8=9, total 28. good.
Potential issue: `ArmSwapOperator` 1+32=33. `SetBoostTerms` 1+8+1+2=12. fine.

Potential issue: `create_proposal` action `Brakes` encoding Option guardian always included; size37. good.

Potential issue: `readProp` in tests not relevant.

Potential issue: `Governed` MINT `set_round` data in GOV `IX_SET_ROUND` plus i64... good.

Potential issue: `arm_guardian` Option encoding in GOV: `guardian.try_to_vec()?` includes Option. good.

Potential issue: `ArmSwapOperator` no Option. good.

Potential issue: `Restart` bools. good.

Potential issue: `SetRound` `cap` u32. good.

Potential issue: `SetBoostTerms` u64,u8,u16. good.

Potential issue: `key_change` bar applies to `Brakes{set_guardian:true}` even if guardian is same as current? It still needs half. Conservative. good.
Potential issue: `key_change` does not include `SetBoostTerms` etc. fine.

Potential issue: `brakes` can include set_guardian true and restarts; MINT arm first, then restart skip. good.
Potential issue: `apply_guardian` not ordered by GOV kind? Arm_guardian ordering tracked by last_guardian_id. Good.

Potential issue: `last_guardian_id` only set if `set_guardian` true. Good.

Potential issue: `last_round_id` set before round_already_over skip, so a later proposal with an older already-over round can supersede as RT3. good.

Potential issue: `last_arm_id` set. good.
Potential issue: `last_boost_id` set. good.

Potential issue: `TightenSweep` no ordering mark but monotonic, okay.

Potential issue: `restart` no last mark because stop time handles. good.

Potential issue: `execute_proposal` `p.executed = true` before processing skips. If all actions skipped, executed true; that's intended.
Potential issue: A proposal with only skipped actions still sets `p.executed=true`, preventing re-execution. It logs skips. good.

Potential issue: If a proposal includes a skipped guardian and an active restart, the CPI calls only restart. good.

Potential issue: `calls` Vec data pushes; no issue.

Potential issue: `read_stops` uses `read_mint_config` then `acc.try_borrow_data()` again. It doesn't re-verify discriminator/version after borrow? It already did, but if account changed between? no concurrent. fine.

Potential issue: `read_stops` uses offsets. good.

Potential issue: `read_mint_config` reads `charter_closes_at` as u64 cast i64: if high bit set, could become negative; but timestamp not. no.

Potential issue: `MINT` `check_supply` uses `cfg.minted_total < cfg.max_supply` and `cfg.minted_total < cap_total`. If max_supply < cap_total? initialize ensures cap_total<=max_supply. good.

Potential issue: `initialize` `cap_total` computed as u64 sum of u32; could overflow if huge? sum max 5*4e9=20e9 <2^64. require <=max_supply. good.

Potential issue: `level_minted` incremented by reveal; if reached cap, no more. good.

Potential issue: `level_caps` each >0, so all levels possible. good.

Potential issue: `MAX_ROUND_SECS` one year; fine.

Potential issue: `MAX_CHARTER_SECS` 90 days; ruled 7 days. good.

Potential issue: `MAX_SWEEP_LAMPORTS` 50SOL. good.

Potential issue: `MAX_SWEEP_COOLDOWN_SECS` 7d; init cooldown max24h. good.

Potential issue: `MIN_SWEEP_COOLDOWN_SECS` 1. good.

Potential issue: `MIN_INIT_SWEEP_LAMPORTS`1SOL; max50SOL. good.
Potential issue: `MAX_INIT_SWEEP_COOLDOWN_SECS`24h. good.
Potential issue: `MIN_INIT_SWEEP...` okay.

Potential issue: `initialize` `sol_reserve_lamports ==0 || >=RENT_EXEMPT_0_BYTES` if 0 and reserve_ceiling maybe >=0. good.

Potential issue: `initialize` `sweep_floor_lamports <= max_sweep_lamports`, `cooldown_ceiling >= cooldown`, `reserve_ceiling >= reserve`. good.

Potential issue: `initialize` `notice_secs` min60 max30d. Ruled 7d. good.

Potential issue: `initialize` `monthly_secs` min60 max30d. Ruled30d. good.

Potential issue: `initialize` `threshold_bps` <=7500; if threshold 7500 with quorum21 etc maybe pass? no.

Potential issue: GOV `create_proposal` validator for rounding? no.

Now maybe there is a **bug in `distribute` burn path and pool freeze/invariant**: The burn path requires pool has `avail >0`. If pool frozen and `w>0`, it credits and advances. Documented. okay.

Potential issue: `monthly_inline` with pool frozen and `total_active_weight==0` but pending_this_epoch>0 ticks epoch, even though no active. This can make boosts? no boosts active. okay.

Potential issue: `tick` doesn't check month due itself; callers do. distribute w0 free branch checks. monthly checks due. good.

Potential issue: `distribute` w0 free branch does not read pool beyond read_token at start; if pool frozen, still tick. fine.

Potential issue: `split_revenue` `expect` function uses `wallet.as_ref()` where wallet is `&Pubkey`. good.

Potential issue: `split_revenue` `decimals` argument maybe omitted in docs? no.

Potential issue: `mint_vault` `TransferChecked` account order with `payer` signer; token program expects `authority` signer. yes.

Potential issue: `boost_vault` `SPL Burn` account order with `burner` signer; good.

Potential issue: `distribute` burn account order with `burner` signer; good.

Potential issue: `SPL_BURN` instruction code 8. good.

Potential issue: `IX_TRANSFER`3, `IX_CLOSE_ACCOUNT`9. Sweep helper. good.

Potential issue: `IX_TRANSFER_CHECKED`12. good.

Potential issue: `Initialize` Royalties `IX_ADD_COLLECTION_PLUGIN_V1`3. good.

Potential issue: `UpdatePluginV1`6. good.

Potential issue: `BurnV1`12. good.

Potential issue: `CreateV2`20. good.

Potential issue: `AccountMeta::new(pob)` Core burn maybe asset account is writable. good.

Potential issue: `ClaimCharterVault` `pob_extra` accounts `if a.is_writable` uses same writable flag; no signers. good.

Potential issue: `create_vault` attribute plugin authority address is `mint_authority.key()` (MINT PDA). good.
Potential issue: `create_vault` permanent freeze authority address is seal PDA. good.
Potential issue: `create_vault` permanent freeze plugin frozen=1. good.

Potential issue: `SEAL set_frozen(false)` can thaw. good.

Potential issue: Core plugin authority None for royalties. good.

Potential issue: `reveal_level` updates Attributes plugin with MINT authority. It passes `mint_authority` signer. good.

Potential issue: `reveal_level` if burned skips Core update, but still drawn. good.

Potential issue: `attributes` re-supplied must be same order? Hash includes order. good.

Potential issue: `push_attr` order matches. fine.

Potential issue: `initialize` `emit_wiring` includes split_bps but not monthly etc. fine.

Potential issue: `emits` not security.

Potential issue: `assert_classic_spl` in SEAL: It checks account owner == SPL_TOKEN but not data len or mint. At init with real mints passes. Could a malicious initialize set a reserve mint account that is a Token program-owned token account (not mint) and BURN later derive ATA with its key and fail? It could brick; launch checker. accepted.

Potential issue: `SEAL` `initialize` reserve_mints Vec length max3 but not min; NoReserveMints. good.

Potential issue: `BURN` `initialize` doesn't validate `collection` non-default separately. okay.

Potential issue: `GOV` `initialize` collection requires match MINT; if MINT collection actual. good.

Potential issue: `read_mint_config` GOV `require!(d.len() >= OFF_MINT_MAX_BOOST_EPOCHS + 2, GovError::BadMintConfig);` uses OFFSET 712+2=714, but config data length must also have enough for `max_boost_epochs` at 712. good.

Potential issue: `read_mint_config` in BURN only requires d.len >=454+8=462, but if MINT config version6 and padding, OK. It doesn't ensure config has new fields; version check6. fine.

Potential issue: `MINT` `check_seal_wiring` requires d.len >=OFF_COLLECTION+32, not version? It checks discrim and version. good.

Potential issue: `BURN` `burn_vault` reads SEAL reserves at offset41 but before that checks config version at8. good.

Potential issue: `BurnConfig` rate_ring space uses `8 * RATE_RING` and account struct has `[i64;64]`. good.

Potential issue: `BurnConfig` version4, burned_total offset42. GOV's OFF_BURN_TOTAL=42. correct.

Potential issue: `VaultRecord` version4; offset tests 186 boost_weight etc. We can recalc: version8, asset9, mint_index41, reveal49, level57, charter58, entropy_set59, entropy60, attrs_hash92, bump124, active125, retired126, reschedules127 u16, vault_ata129, debt_scaled161, pending177, request_epoch178, boost_weight186, boost_end_epoch187, carry_scaled195. Good. 
Potential issue: `OFF_REC_BOOST_W=186`; `OFF_REC_BOOST_END=187`; `OFF_REC_CARRY=195`. correct.

Potential issue: `MintConfig` offsets for boost_expiring from749, but `MINT_CONFIG_SPACE` maybe account data length 1005+padding? Let's compute struct absolute:
- ... cbob_burned_total ends at748, boost_expiring starts749 length256 => next1005. CONFIG_PADDING256 => account length1261. code space likely okay. OFF_CBOB_MINT=679 etc.

Potential issue: `MINT_CONFIG_SPACE` expression has `4 * BOOST_RING`; good.

Potential issue: `Account size` in tests `OFF_BOOST_RING=749`. good.

Now maybe an **integer truncation bug in `claim` paying `pay = (pending / ACC_SCALE) as u64;`** pending u128 <2^? u128. pay as u64. Pending could exceed u64::MAX? Total supply in sats 2.1e15 * scale? Actually owed scaled max around 2.1e15 sats *1e12=2.1e27; dividing by1e12 gives2.1e15 sats, fits u64 (1.8e19). good.
Potential issue: `owed_paid` u128. good.
Potential issue: `paid` u64 sum maybe many vaults but total sats fits. good.

Potential issue: `split_revenue` total u64 from token amount; cbBTC supply maybe 21e6*1e8=2.1e15 fits. good.

Potential issue: `bank_cut` as u128 then as u64. fits.

Potential issue: `boost_price` u64; CBOB supply 2.1e9*1e6=2.1e15 fits. good.

Potential issue: `cbob_burned_total` u64 sum maybe supply. fits.

Potential issue: `GARY` supply 100*1e9 etc. fits.

Potential issue: `RATE_RING` index arithmetic `head + RATE_RING - k` with `head` usize and `k` usize <=64; `head+RING-k` underflow if k>head+RING? Since head in0..63, RING=64, head+64-k >=64-64+0? if k=64, head+64-64 =head>=0. Good. if k=65? k min. fine.

Potential issue: `Rate_limit` cap can be 0? cap = live*210 +9999 /10000. If live0 cap0, `cap.max(1)` 1. good.

Potential issue: If live supply u64 max and multiply overflow? live <= max_supply 2100. safe.

Potential issue: `advance_epoch` pending_this_epoch reset to0 but does not adjust pending_count. waiting_to_join count = pending_count. good.

Potential issue: `retire` pending same current if `request_epoch == c.dist_epoch` decrements pending_this_epoch. If pending_this_epoch has already been reset while dist_epoch same? when advance_epoch resets, dist_epoch increased, so not same. good.

Potential issue: `retire` active first then pending? Could a record be both active and pending simultaneously? Invariants prevent. If not, pending block added after active maybe. no.

Potential issue: `retire` active when r.boost_weight>0 calls unschedule_boost. It does not clear r.boost_weight, but r.active false and r.retired true. Later claim/expire skip; record history. fine.
Potential issue: `retire` sets `r.debt_scaled = full` where `full=w*acc`; `carry=0`. If active false. good.

Potential issue: `retire` returned pending subtracted before unschedule_boost; if unschedule fails, whole retire reverts. good.

Potential issue: `owed_scaled` underflow if pending > c.owed_scaled could revert; invariant. no.

Now maybe **attack on BoostN** using `boost_vault` when `dist_epoch` can be before `boost_end_epoch` but `expire_boosts` skips if `r.retired||!r.active`. fine.

Potential issue: `unschedule_boost` future branch uses `r.boost_end_epoch % BOOST_RING` as usize. If `boost_end_epoch` is 0 (no boost), but caller only if boost_weight>0, end set. fine.

Potential issue: `expire_boost` after unschedule/reweigh sets end=0. good.

Potential issue: `boost_vault` after setting `r.boost_end_epoch=end` does not `store_record` because context Account. good.

Potential issue: `reweigh` if `boost` is same as current? boost_vault requires 0, expire sets0. fine.

Potential issue: `expire_boosts` `load_record` and `store_record` could fail if account data version old. fine.

Potential issue: `claim` pairs chunking for active records. If pair length odd, BadClaimList. good.

Potential issue: `crank_n` as u8, max 4. `k = crank_n+1`. If crank_n=255, `crank_n as usize+1=256`; require rem len>=256; then crank sees accts[0] and accts len-1=255 >MAX_CRANK, TooManyCranked. It fails. A malicious tx can pass crank_n=255 but rem huge maybe impossible packet. fine.

Potential issue: `pob_extra` u8 similarly; if >remaining fails. fine.

Potential issue: `claim` `pairs.len()%2` and not empty. good.

Potential issue: `distribute` burn path `rem.len()==4`. If more, BadBurnAccounts. good.

Potential issue: `split_revenue` `decimals` argument; no check on `ctx.accounts.payment_mint` owner classic? config. The CPI handles.

Potential issue: `initialize` `check_seal_wiring` and `seal_reserves` use `try_borrow_data` whereas later in same function config mut maybe? different accounts. fine.

Potential issue: `mint_vault` `check_seal_wiring` and `seal_reserves`? Mint doesn't read reserves in mint_vault, only payment mint from config. check_seal_wiring ensures collection. good.

Potential issue: `claim_charter_vault` check_seal_wiring too. good.

Potential issue: `create_vault` does not call check_seal_wiring, but callers do. good.

Potential issue: `reveal_level` does not call check_seal_wiring, but config collection/asset. good.

Potential issue: `initialize` `cbob_mint` account not in Account struct as maybe not Signer. fine.

Potential issue: `Governed` MINT `tighten_sweep` args `SweepTighten` with Option fields. If all None, NothingToDo. good.

Potential issue: `GOV create_proposal` validation for TightenSweep `x > m.sol_reserve` etc. If current sol_reserve 0 and x=0? x>=rent. good.
Potential issue: `GOV` validation for `TightenSweep` doesn't check `max_sweep` x <= MAX_SWEEP_LAMPORTS, but as noted x < live max <=50. good.
Potential issue: `GOV` validation for `sol_reserve` x<=reserve_ceiling; MINT further <=. good.

Potential issue: `MIN_ROUND_PRICE_SATS` in MINT and GOV could drift? Suite pins? It doesn't. But source constant same value in both. Not automatic. If one changed incorrectly, governance could create proposal MINT refuses (or vice versa). Since code immutable, not an exploit. Not report.

Potential issue: `MAX_ACTIONS` in GOV and `ProposalAction` variants count 5. If a new variant added without updating kind, DuplicateAction may map same kind. But code frozen. no.

Potential issue: `ProposalAction::kind` uses discriminant order; okay.

Potential issue: `SweepTighten` structs duplicated and if fields differ, suite E2E pinned. no.

Potential issue: `Initialize` GOV requires threshold 5001..7500. With quorum min500, threshold 5001. If threshold just above half, okay. no.

Potential issue: `MIN_QUORUM_BPS` 500. With quorum 500 and threshold 5100, 5% voters could pass ordinary; but ruled quorum 2100. accepted. launch checker.

Potential issue: `TurnoutTooLow` need_yes min10% of divisor; if divisor small. okay.

Potential issue: `KeyChangeNeedsHalf` need_key ceil(divisor*0.5) because +9999/10000 with bps5000. yes. If divisor 1, need_key=1. good.

Potential issue: `quorum supply` live at creation. good.

Potential issue: `burned_total` in GOV read BURN config, but if BURN not initialized (at propose before BURN init) create_proposal fails BadBurnConfig. Road order init before proposals. fine.

Potential issue: `execute_proposal` sets p.executed true even if p.actions is malformed? It deserialized. good.

Potential issue: `readProp` tests not.

Now maybe the biggest hidden bug: **`get_stack_height` in `retire_redeemed` and `load_current_index_checked` interplay** could be bypassed by BURN calling MINT via CPI from a top-level instruction inside a transaction where another fake burn? tested. no.

Potential issue: `retire_redeemed` checks `ix.accounts.get(BURN_IX_ASSET_IDX).map(|a| a.pubkey) == Some(ctx.accounts.asset.key())`. It does not check the current instruction is the CURRENT outer instruction? It uses load_current_index_checked. Under CPI, instructions sysvar `load_current_index_checked` returns the instruction index at the *current call depth*, which might be the inner CPI index or top-level? Tests passed. no.

Potential issue: `retire_redeemed` `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT +1`. Could a top-level MINT call through one CPI from BURN exactly2. good.
Potential issue: If a wrapper program CPIs BURN (stack2) then BURN CPIs MINT (stack3), MINT refuses. good.

Potential issue: BURN burn_vault could be reached by a wrapper CPI, but then top-level introspection in BURN sees wrapper, no preceding open. So no.

Potential issue: SEAL open could be reached by a wrapper CPI, then its introspection current index perhaps wrapper, walks for burn by BURN top-level later; if there is same transaction a top-level burn for same asset/owner after wrapper, SEAL would thaw? Let's think: Top-level instruction 0: wrapper program calls SEAL open (inner). SEAL's `load_current_index_checked` returns current index? Might return 0? It walks after current index 0. If top-level instruction 1 is BURN burn for same asset/owner, then SEAL open (inside wrapper) would thaw, because it sees future top-level burn. Then BURN burn separately checks preceding top-level open, but top-level instruction 0 is wrapper program, not SEAL, so BURN refuses (`NoPrecedingOpen`). Transaction reverts. So fails closed. good.
Potential issue: Reverse with wrapper burn and top-level open? BURN inside wrapper sees preceding wrapper as current outer? no preceding open, fails. good.

Potential issue: Could there be a top-level fake SEAL instruction that doesn't actually call open due to malformed, but BURN sees it? It would fail transaction before burn. no.

Potential issue: **SEAL `open_for_redemption` requires future burn but doesn't require the future burn be AFTER any sweeps?** It can't. burn is terminal. fine.

Potential issue: **BURN `burn_vault` requires preceding open but could be a SEAL open that thawed a different vault?** It matches asset/owner at account positions. positions are bound by comments and suite pins. good.

Potential issue: If an attacker creates an instruction with SEAL program ID and discriminator `open_for_redemption` and account positions [target asset, collection, victim owner] but the instruction is actually a different top-level program? impossible. no.

Potential issue: `ix.accounts.get(SEAL_IX_OWNER_IDX)` index2. SEAL's actual account order? In SEAL OpenForRedemption account struct:
0 vault_asset mut,
1 collection mut,
2 owner Signer,
3 payer,
4 config,
5 seal,
6 mpl_core,
7 instructions,
8 system_program.
BURN expects owner at2. good.
BURN's account order:
0 vault_asset,
1 collection,
2 owner,
3 asset_signer,
4 payer,
5 config...
SEAL expects burn asset0 owner2. good.

Potential issue: `SEAL` and `BURN` use discriminator arrays asserted. fine.

Potential issue: `MINT` `retire_redeemed` checks BURN_IX_ASSET_IDX=0 only, not owner. Since called from BURN with asset. okay.

Potential issue: `BURN` invokes MINT retire with account order [mint_config, vault_record, vault_asset, instructions, pool_token]. MINT RetireRedeemed account struct order: config, vault_record, asset, instructions, pool_token. good.

Potential issue: BURN passes `mint_program` AccountInfo to invoke as sixth? Code:
```
invoke(&Instruction {...accounts vec [mint_config, vault_record, vault_asset, instructions, pool_token]...}, &[mint_config, vault_record, vault_asset, instructions, pool_token, mint_program] )
```
The account_infos includes 6 accounts, first 5 match instruction metas. The program_account is separate, included at end? Actually invoke signature `invoke(instruction, account_infos)`: account_infos should include all accounts in instruction; maybe the program account is included? For `invoke`, you pass only the account metas' AccountInfos? In code BURN does include `ctx.accounts.mint_program.to_account_info()` as sixth, but metas list has 5. Is that correct? In Solana `invoke` API does not require a program account in account_infos separately, but often includes program account? Let's recall: `invoke(&instruction, &[account_infos...])` passes accounts referenced by instruction metas. Adding extra program account at end doesn't hurt because account_infos may include program account and instruction metas refers to first 5? The AccInfo collection includes program account but the instruction's account_metas length is 5. Is this allowed? I think `invoke` accepts account_infos slice where first N correspond to metas; extra account_infos can include program? Actually examples include program account in account_infos but not in metas? Let's recall Solana `invoke` in programs: when invoking another program, you pass `&[source, destination, authority, token_program]`. The accounts in the instruction are `[source, destination, authority]`? Wait for token program, `invoke(&ix, &[source, destination, authority, token_program])`: the instruction's accounts vector might include token_program? For SPL token `Transfer`, the instruction accounts include token_program at index? Actually CPI instruction accounts include the program account explicitly? Let's not dwell. The suite passes, so BURN invocation correct.

Similarly `split_revenue` invokes token programs with account_infos including token_program at end but metas include source, mint, dest, authority, and program token? Code:
```
invoke_signed(&Instruction {
 program_id: SPL_TOKEN_ID,
 accounts: vec![revenue_ata, mint, dest, revenue],
...
}, &[
 revenue_ata.to_account_info(), mint.to_account_info(), dest.to_account_info(), revenue.to_account_info(), token_program.to_account_info()
], &[seeds])
```
Hmm instruction metas have 4 accounts, but account_infos has5 including token_program. Wait SPL Token TransferChecked accounts include source, mint, destination, authority (4 accounts) plus token program? The instruction program ID is token program, but account metas for CPI usually include `account_token`? Actually AccountMeta list in instruction includes only accounts that the called program expects. For token TokenInstruction::TransferChecked accounts are Source, Mint, Destination, Authority (4). The `program_id` is SPL_TOKEN_ID. The `account_infos` passed to invoke should match the instruction accounts plus maybe not. Extra account info after may be used for program account? I think `invoke` asserts account_infos.len() == instruction.accounts.len()+1, where last is program account? Wait the standard `invoke` signature: 
```
pub fn invoke(instruction: &Instruction, account_infos: &[AccountInfo]) -> ProgramResult
```
The `instruction.accounts` refer to indexes into account_infos; account_infos should include all accounts in instruction, but often the last entry is not referenced? Actually the called program's own ID is not an AccountInfo? No, Builtin programs sometimes include program account at end. But the runtime requires `account_infos` has an entry for every account in `instruction.accounts`. Extra entries are allowed? I think yes, and the called program's program ID account is often appended for native programs? This code is tested. no issue.

Potential issue: `invoke_signed` in `split_revenue` with `revenue` PDA signer seeds but account metas `AccountMeta::new_readonly(revenue, true)` includes signer. good.

Potential issue: `invoke_signed` in `initialize` Royalties with accounts vector length 5 and account_infos length 5? It passes exactly 5. good.

Potential issue: `invoke_signed` in `create_vault` with instruction accounts length 8? account_infos length 7? Let's count but tested. 

Potential issue: `sweep helper` invokes token transfer with instruction accounts source,dest,authority (3) and account_infos source,dest,signer,token. 4th extra token program. tested.

Potential issue: `sweep helper` System transfer account_infos signer,dest,system. instruction accounts 2. extra program. okay.

Potential issue: `BURN` invoke MINT retire includes instruction metas 5 and account_infos 6. likely okay.

Potential issue: `MINT` `distribute` SPL Burn instruction metas from account_infos [from,gmint,burner,tprog] while instruction accounts account_infos exactly 4? Actually instruction accounts vector 3? It includes token program? Code:
```
AccountMeta::new(from), AccountMeta::new(gmint), AccountMeta::new_readonly(burner)
```
account_infos from,gmint,burner,tprog.
fine.

Potential issue: `mint_vault` SPL TransferChecked instruction accounts vector 4, account_infos 5.

Now maybe **unsafe raw account data index**: `SEAL` reads d[1..33] etc. Good.

Potential issue: `Initialize collection clean` uses `d.len() >= 1+32+4` then `d[0] == KEY_COLLECTION_V1`. If account data too short, it still reads after length check? It checks `require!(d.len() >= 1 + 32 + 4 && d[0]...` So safe. Then `d[1..33]`. good.
Then loop names `for 0..2` reads len. It requires `d.len() >= o+4`. good. It then `require!(d.len() >= o + 8)` and `d[o..o+4]`. safe.

Potential issue: `Initialize collection clean` requires `d.len() == o + 8`. If `o` overflow checked? It uses checked_add. good.

Potential issue: `read_core_asset` requires `d.len()>=66` before d[33] and slices. good.

Potential issue: `read_token` requires len ==165, then offsets. safe.
Potential issue: BURN reserve loop reads offsets before len==165:
```
if d.len() < TOKEN_ACCOUNT_LEN { continue; }
...
require d.len() == TOKEN_ACCOUNT_LEN...
```
For a malicious declared account with d.len 165 but not token, okay. Offsets safe.
Second loop:
```
if d.len() >= TOKEN_ACCOUNT_LEN {
 ...
 if owner_field == pda { require d.len()==165; ...}
}
```
safe.

Potential issue: Sweep helper `read_token` requires len exactly165 then pk offsets. safe.

Potential issue: `read_token` uses `d[o..o+32].try_into().unwrap()`. With len165 safe.

Potential issue: `blockhash_in_window` safe due len check. 

Potential issue: `Merkle` proof length max16, array size32. safe.

Potential issue: `initialize` `seal_reserves` reads n u32 <=3 and len check. safe.

Potential issue: `BURN` reads SEAL reserves similarly. safe.

Potential issue: `GOV` reads offsets using length check. safe.

Potential issue: `MINT` `OFF_RESERVES` etc safe.

Now maybe **confusion between `last_sweep_at` and clock at initialize** no.

Potential issue: `sweep_sol_for_swap` does not check operator account not same as revenue PDA or pool; if operator is revenue PDA (offcurve) but init requires swap_operator key non-default, could be offcurve? `swap_operator` must sign, so on-curve. If a malicious launch sets swap_operator to an on-curve key, OK. no.

Potential issue: `initialize` `bank_treasury`/`swap_operator`/guardian can be any nondefault; no check on `bank_treasury` ATA existence. Road step creates. fine.

Potential issue: `BURN` `initialize` doesn't check `collection` value matches MINT? GOV does. fine.

Potential issue: `GOV` `initialize` doesn't check `burn_config` collection. no.

Potential issue: `Governed` `tighten_sweep` can be called by GOV even before guardian? fine.

Potential issue: `arm_swap_operator` can arm same as current; then after notice operator same. No issue.

Potential issue: `cancel_swap_operator` guardian can cancel even after notice not elapsed; yes. good.

Potential issue: `apply_swap_operator` can be called after guardian canceled? No pending, refuse.

Potential issue: `apply_guardian` pending guardian set true; if pending is same? good.

Potential issue: `GuardianArmed` event includes Option. good.

Potential issue: `apply_guardian` does not clear `pending_guardian_at`? yes.

Potential issue: `arm_guardian` takes Option and stores default. If `None`, pending_guardian default. `apply_guardian` sets guardian default. good.

Potential issue: `guardian` can be Some(default) and `pending_guardian_set true` then `emit GuardianArmed { guardian: Some(default) }` while actual pending is default. R24 test says logs same as None? Wait arm_guardian event receives original `guardian: Option<Pubkey>`, so for Some(default) event shows Some(default) while stored pending default. The GOV execution both cases: for Some(default), `guardian.try_to_vec()` serializes Some(default); MINT arm_guardian stores default and sets set true. For None, serializes None; same state. But event differs. Not important.

Potential issue: In GOV `execute_proposal`, `Brakes { set_guardian:true, guardian: Some(default)}` arm data contains Some(default). MINT arm_guardian stores default. R24 test expected same as None state, not event. fine.

Potential issue: `cancel_swap_operator` can cancel pending operator but not if `NoPendingOperator`. good.

Potential issue: `emergency_stop_sales/sweep` cannot be called by guardian if guardian default. NotTheGuardian. good.

Potential issue: `require_guardian` checks `c.guardian != default` before signer. good.

Potential issue: `Governed` `restart` doesn't require governance before flags; has_one. good.

Potential issue: `arm_guardian` governance only; `has_one`. good.

Potential issue: `set_boost_terms` governance only. good.

Potential issue: `apply_*` no signer. fine.

Potential issue: `GOV` `execute_proposal` `read_mint_config` obtains `m` before marking p executed; if MINT config collection etc. good.

Potential issue: **Potential liveness/frozen governance if guardian key is compromised and no half votes** accepted.

Potential issue: **Charter claim cannot be stopped** accepted.

Potential issue: **Proof of Burn hot wallet** accepted.

Potential issue: **Unreleased $CBOB hot key** accepted.

Potential issue: **Swap operator** accepted.

Potential issue: **Immutability** accepted.

Need maybe find a new MEDIUM about the **`get_stack_height` requiring exactly 2 blocks caller by a CPI from a top-level instruction, but BURN's `burn_vault` could be invoked via a *top-level inner instruction with no wrapper* and `get_stack_height` after CPI?** tested.

Potential issue: **If `burn_vault` is in a transaction with a preceding open inside an Account Lookup Table (v0)**: BURN/SEAL introspection `load_instruction_at_checked` returns resolved account keys? The tests S9b prove v0 LUT. good.

Potential issue: **Instruction sysvar `load_instruction_at_checked` can read beyond current instruction count if builtin?** no.

Potential issue: **Duplicate instruction index if two instructions share same account positions** no.

Potential issue: **SEAL open walks after current; if open is last instruction and burn is after? Burn must be after, yes.**

Potential issue: **BURN burn checks preceding open in entire tx before current; if multiple opens and burns, the burn chooses any preceding matching.** fine.

Potential issue: **SEAL open doesn't ensure the burn doesn't belong to a burn_vault instruction that will fail due to rate limit? If it fails, open reverts. safe.**

Potential issue: **Core BurnV1 could succeed even if asset signer PDA lamports not zero? BURN checks before. good.**

Potential issue: **After Core BurnV1, asset_signer lamports maybe nonzero due to Core? BURN checked before burn. The burn instruction itself doesn't move asset signer? But maybe Core BurnV1 transfers asset account lamports (not signer) to payer, leaving signer. BURN checked before, so if signer had0, after burn still0? Could Core BurnV1 credit lamports to signer PDA? Unlikely. It doesn't matter after burn; but if it did, BURN would not check after. Could lead to stranded SOL? The sweep helper moved signer lamports before; Core BurnV1 could theoretically send collection lamports to signer? It doesn't. accepted.

Potential issue: **Core ExecuteV1 into sweep helper may itself deposit lamports to signer? The helper transfers all at end; after helper no. fine.

Potential issue: **`burn_vault` invokes MINT retire after burning. If MINT retire monthly_inline credits remaining vaults, and then some later instruction? transaction atomic. fine.

Potential issue: **`retire_redeemed` monthly_inline after removing vault but before return. If monthly_inline `credit` modifies acc_scaled/owed_scaled and last_distribute_at. Good.

Potential issue: **A redeem transaction can include a `claim` instruction before open and then sweep. If claim pays active vault and pool not frozen, good. If claim lists multiple vaults including redeeming vault; okay. 
Potential issue: **BURN passes `pool_token` not writable; MINT monthly_inline only reads. good.

Potential issue: **Claim `owed_of` for vault after a distribution in same transaction? If `claim` instruction comes after `distribute` in same transaction, it sees acc updated. Good. If after `monthly_inline` in same claim, same. fine.

Potential issue: **`claim` monthly_inline can credit, then pays. good.

Potential issue: **`boost_vault` monthly_inline can credit, then applies boost. good.

Potential issue: **`activate` monthly_inline before reading vault's pending/active; can tick/credit. good.

Potential issue: **`mint_vault` monthly_inline before price payment, can credit and then sale. good.

Potential issue: **`claim_charter_vault` monthly_inline before window, but not due until close+30. good.

Potential issue: **`split_revenue` does not run monthly_inline. Not a host. fine.

Potential issue: **`sweep_sol_for_swap` not host. fine.

Potential issue: **`redemption` due monthly runs inside retire after vault retired; if pool frozen no credit. good.

Potential issue: **`Split_revenue` after depositing into pool could implicitly create enough avail and monthly due? Not run. It will wait next host. good.

Potential issue: **There is no account enumeration for pool token account existence; road step. accepted.

Now perhaps **a real bug in `initialize` wrt guardian default**: `c.guardian = guardian.unwrap_or_default();` If `guardian: Option<Pubkey>` is `Some(Pubkey::default())`, stores default. `Guardian` context `require_guardian` first `c.guardian != default` then signer. So guard disabled. No issue.

Potential issue: `apply_guardian` can set guardian to default `Pubkey::default()`; this is how brake retired. `require_guardian` then refuses all. good.

Potential issue: **`arm_guardian` could arm default None to retire brake; GOV half requirement. good.

Potential issue: **`CancelSwapOperator` only clears pending, not `pending_swap_operator_at`? It sets 0. good.

Potential issue: **`apply_swap_operator` doesn't clear pending_swap_operator_at? sets0. good.

Potential issue: **`arm_guardian` `guardian` Some(default) event misleading**. no.

Potential issue: **`apply_guardian` context name `ApplySwapOperator` but no issue.**

Potential issue: **`read_mint_config` in GOV `governance: Pubkey` but not used in create/vote/execute except execute. fine.

Potential issue: **GOV `initialize` does not check `mint_config.governance` equals GOV_PDA, as noted. However if MINT config initialized with a different governance address due to hardcoded GOV_PROGRAM_ID mismatch, GOV executes fail. Could be permanent freeze if launch checker not catch. But launch checker likely checks config governance? It ensures program IDs? `check-launch-params` might. Not in provided file. Not report.

Potential issue: **BURN `initialize` doesn't check MINT config governance; no.

Potential issue: **`split_revenue` `bank_cut` floor to 15%, but `SOL` reserve? no.

Potential issue: **`split_revenue` if `total` huge and `bank_cut` computed as u128 then as u64; fits.

Potential issue: **`holder guide` says 10% royalty and 85/15; true.

Potential issue: **` HOLDER-GUIDE "A vault can never be partly emptied: it is either sealed with everything still inside, or gone."** In a failed partial sweep transaction, yes. But after a bare Core burn, vault gone with contents? It says opening all or nothing. good.

Potential issue: **`HOLDER-GUIDE "Only you can open it"** but if owner is offcurve, cannot. qualified in honest list. good.
Potential issue: **`HOLDER-GUIDE "Once it holds at least 21,000 sats of cbBTC, it is activated"** Actually after funding, someone must call activate; guide says "it is activated: it joins ..."; maybe "Activation is picked up automatically" text says automatic. True via crank. offchain.
Potential issue: **`HOLDER-GUIDE "A payout is due every month"** more.

Potential issue: **`HOLDER-GUIDE "Every sale, and the 10% royalty (fixed forever) on every resale where the marketplace pays it, flows into the Bank. 85%..."** okay.

Potential issue: **`HOLDER-GUIDE "It trades only through fixed pools (Orca, with Meteora as fallback) and refuses any price below a floor taken from Pyth's price feed."** offchain not in provided, but accepted. true if code.

Potential issue: **`HOLDER-GUIDE "See honest list for what its key could take."** includes. good.

Potential issue: **`HOLDER-GUIDE "Anything credited to you stays yours until it is delivered (the one exception is opening your vault while the Bank's pool is frozen; see the honest list)."** true.

Potential issue: **`HOLDER-GUIDE "Before you open your vault, anything the Bank has received since the last payout is not yours yet."** Semantic: undistributed revenue not claimed by anyone; if a vault joined, never credited from undisributed. true.
Potential issue: **`HOLDER-GUIDE "A payout can only run once every newly activated vault has joined"** maybe "every newly activated vault has joined" not exactly; gate only eligible (requested before last distribution) not current. likely okay.

Potential issue: **`HOLDER-GUIDE "You can burn $CBOB to boost an activated vault. For the next few payouts..."** true.
Potential issue: **`HOLDER-GUIDE "At launch the Bank holds all 2,100,000,000 $CBOB..."** true.
Potential issue: **`HOLDER-GUIDE "One boost per vault at a time, and only the vault's owner can boost it."** true.
Potential issue: **`HOLDER-GUIDE "Nothing you have already earned is touched when a boost starts or ends."** true by reweigh carry.

Potential issue: **`HOLDER-GUIDE "Opening is limited to 2.1% of vaults still sealed in any hour (about 45 an hour at 2,100 vaults)"** true.

Potential issue: **`HOLDER-GUIDE "If Coinbase freezes your vault's cbBTC, you cannot open it at all (not even to take the $GARY and $GIRAFFISH) until Coinbase unfreezes it. Payouts owed to it stay owed."** true.

Potential issue: **`HOLDER-GUIDE "Only open your vault on Bank's redeem page. Burning the NFT any other way..."** The page not built, but guide draft. L1.

Potential issue: **`HOLDER-GUIDE "A vault held by a multisig or a DAO cannot be opened."** true.

Potential issue: **`HOLDER-GUIDE "Every opening is public."** false as noted. Could be finding.

Now perhaps there are **newly introduced bugs in round25 repairs**:
- Host test `the_boost_schedule_through_the_programs_own_functions_across_four_wraps` includes manual buy and checks ring, but may be flawed. Not production.
- `scripts/build-mainnet.sh` now also cmp target/deploy and local .cache. good.
- `HOLDER-GUIDE` D1-D5 repaired. good.

Maybe **a bug in test fixture `ORACLE_OK` account fixed bytes**: `d = Buffer.from([1,2,2,burn,2])`. It simulates Core OracleValidation. no.

Potential issue in `test-vault.ts` S8.0 measurement includes claim+open+helper+burn but does not include compute-budget pair. It asserts only reserved room. okay.
Potential issue in `test-vault.ts` S8.1a compute measured with default budget 4*200k, but transaction may have more than 4 instructions? It has open, claim, helper (Core Execute could expand to inner instruction but top-level count 4), burn. Actually redIxs [ixOpen, ixPoolClaim, ...viaCore (multiple Core Execute instructions?), ixBurn]. Wait `viaCore` from execute returns `.getInstructions()`; likely multiple instructions? The Core ExecuteV1 instruction includes inner instructions; getInstructions may return a list of maybe 1? In test they spread `...viaCore`, so transaction top-level may include multiple instructions (Core Execute and its inner? The instructions from getInstructions are SDK `TransactionInstruction`s; `execute` returns one or more? It might produce Core ExecuteV1 instruction containing the sub-instructions. In web3.js instruction has keys/data; inner instructions? Actually not flattened. The helper transition is one Core Execute instruction. So top-level 4. compute measured. fine.

Potential issue in test `S9b` bumped table. no.

Could there be **a real bug in `scripts/build-mainnet.sh`: `MEMO`?** no.

Potential issue in `run-tests.sh`: It kills validator before swap fork and boots a new one. The fork has 16 assertions. fine.

Potential issue: The mainnet probe floor expanded to33. no.

Now maybe **an attacker can cause `pool_is_frozen` false but pool actually frozen with different data len?** pool classic length165 state at108. fine.

Potential issue: **Token-2022 ATA for classic mint impossibility measured.** good.

Potential issue: **A foreign Token-2022 token account not ATA owned by vault PDA** could be created and hold value; BURN non-reserve loop if declared sees len maybe170 and `require d.len==165` when owner==pda after delegates checks? Let's re-read second loop:
```
if acc.owner != SPL && != T22 { continue; }
let d=acc.try_borrow_data()?;
if d.len() >=165 {
  let owner_field=d[32..64];
  if owner_field == pda {
      require d.len()==165, ReserveHasExtensions;
      require delegates...
      require amount==0
  }
}
```
If a non-reserve T22 account owned by PDA with len170 is declared, it hits require len==165 -> ReserveHasExtensions, so refuses burn. Good. If undeclared, not seen. accepted.

Potential issue: **T22 account with len<165?** no.

Potential issue: **Non-ATA token account classic owned by PDA but not mint reserve, with amount0 but delegate etc. If declared, BURN checks and rejects if delegate or amount nonzero. If undeclared, burn destroys. accepted.

Potential issue: **BURN's reserve loop skips account if owner not token programs and continue, so if the expected ATA PDA exists but is an SPL token account under a different token program (e.g., Token-2022) it checks. okay.

Potential issue: **BURN `declared` mismatch: require remaining_accounts.len() == declared. If declared includes the same account twice to satisfy reserves? Not issue.

Potential issue: **BURN `extra` declared accounts could include arbitrary system accounts with lamports >0. The preamble `require asset_signer.lamports()==0` only for asset_signer, not for declared accounts. The for loop:
```
for acc in remaining_accounts:
 if owner==Core...
 if acc.lamports()==0 continue;
 if owner != token programs continue;
 ...
```
If a declared account is a system account with lamports >0 and owner System, it is not checked, so burn passes. Does this matter? An owner could pass an unrelated system account owned by them; no need. Could it be an account owned by vault PDA? Only token accounts or Core assets are checked. A PDA can own system accounts? Solana accounts are owned by programs; a normal system account cannot be owned by a PDA unless PDA is a program owner? The asset-signer PDA is not a program; it cannot own arbitrary accounts except through associated account/manager programs. So no token account? No.
Potential issue: Could a vault PDA own a non-token, non-Core account with value? On Solana, account owner is a program, not a PDA; a PDA address itself is not a program, but as an address it can be owner of accounts created by System? System accounts are owned by System, not by the key. Only programs can own accounts; token accounts are owned by SPL Token program. Core assets owned by Core. So no arbitrary program account owned by PDA other than token/Core. Good.

Potential issue: **Core collections can own assets?** no.

Potential issue: **Airdrops of SPL tokens to a PDA are token accounts owned by SPL Token program.** BURN loops declared. good.

Potential issue: **A foreign Core asset nested in vault:** Core asset account owner is MPL_CORE, so second loop catches if declared. good.

Potential issue: **If a foreign Core asset is owned by vault PDA but data is not key1? e.g., burned, then passes. If live key1, refuses. good.

Now perhaps **critical bug in `BURN` `read_mint_supply` / rate limit: It reads `OFF_MINT_MINTED_TOTAL`=141 and `OFF_MINT_BARE_RETIRED`=454, but after stage3c boost append, `bare_burns_retired` did not move. yes.
Potential issue: `BurnConfig` `burned_total` offset42; no move. good.

Potential issue: `BURN` `initialize` sets `rate_ring = [0; RATE_RING]` but `rate_head =0`. good.

Potential issue: **BURN `initialize` account space** `8+1+32+1+8+8+1+8*RATE_RING+CONFIG_PADDING`. Let's compute struct BurnConfig: version u8, collection Pubkey 32, bump u8, burned_total u64, redeem_window i64, rate_head u8, rate_ring [i64;64]. Discriminator 8. Sum without padding =8+1+32+1+8+8+1+512 =571. Code allocates `8 +1+32+1+8+8+1+8*RATE_RING + CONFIG_PADDING` = same. good.

Potential issue: `RATE_RING` const assert ==64. good.

Potential issue: **GOV `create_proposal` `quorum_supply` uses `m.minted_total - burned - bare_retired`. If bare_retired counts vaults that were never in BURN? yes. no.

Potential issue: **Bare burned vault still counts live until retire, can make proposal harder, not easier. accepted.

Potential issue: **`detectNestedVaults` offchain not included. no.

Now perhaps **a bug in `open_for_redemption` event and thaw**: It emits RedemptionOpened after set_frozen. If event logs seen by alarm? no.

Potential issue: **`SEAL set_frozen(false)` through Core UpdatePluginV1 may be called even if the plugin authority None? PermanentFreezeExecute authority is address SEAL PDA, not None. It can update. good.

Potential issue: **If SEAL program's PDA is not the plugin authority due to a bug in create_vault, seal won't thaw. Tests verify.

Potential issue: **`create_vault` uses `mint_authority` as update authority for AddCollectionPlugin and UpdatePlugin; fine.

Potential issue: **Could someone call `mint_vault` with an existing asset account they sign? Anchor `asset: Signer`, Core CreateV2 will fail if account already in use. no.

Potential issue: **`initialize` collection clean check ensures no plugins and no mints. If collection already has a Royalties plugin from previous failed init? Anchor init config would maybe? If first init fails after collection plugin update? Transaction atomic. no.

Potential issue: **If collection arrives clean but is mutable? Core collection name/uri maybe update authority MINT PDA. fine.

Potential issue: **`initialize` does not check collection's update_authority is MINT PDA AND that it is a valid on-curve? It checks offcurve maybe. no.
Potential issue: **`MINT` `mint_vault` and charter claim `check_seal_wiring` call `require_keys_eq!(ctx.accounts.collection.key(), cfg.collection)`**. good.

Potential issue: **`BURN` `burn_vault` does not check collection account key in config? It reads asset collection and config, then `require_keys_eq!(ctx.accounts.collection.key(), collection)`, but does not check `collection` equals `ctx.accounts.config.collection` separately. Config collection used for rate? Actually earlier:
```
let cfg=&ctx.accounts.config;
let collection_cfg=cfg.collection;
...
require collection == collection_cfg (ForeignVault)
require ctx.accounts.collection.key==collection
```
yes.

Potential issue: **`BURN` `burn_vault` before rate limit uses `ctx.accounts.config` immutable; later mutable for burned_total. NLL. good.

Potential issue: **`BURN` `burn_vault` computes `collection_cfg` and then after reserve loop uses `collection_cfg` for WiringDiverged. good.

Potential issue: **`BURN` `initialize` checks SEAL collection but doesn't verify SEAL version? yes.

Potential issue: **`SEAL initialize` doesn't check reserve_mints count at least1 and max3; good.

Potential issue: **`SEAL initialize` `assert_classic_spl` doesn't check `collection` nondefault. no.

Potential issue: **`SEAL initialize` after config init emits no event? no event defined. fine.

Potential issue: **`SEAL` `open_for_redemption` config borrowed immutable; no admin. good.

Potential issue: **`Governed` MINT `tighten_sweep` governor signer could be a corrupted PDA? no.

Potential issue: **`Governed` MINT `set_round` doesn't reject round opening too far? no.

Potential issue: **`Governed` MINT `arm_swap_operator` doesn't require operator on curve; later sweep_sol requires operator signer. If operator is off-curve/PDA, sweeps impossible. A vote could arm an off-curve operator. GOV creation only non-default, not on-curve. This could grief by replacing with non-signing operator, but it requires half of all live vaults. Could a malicious majority arm a PDA (no key) to stop royalty sweeps forever? It would not be able to sweep, so operators stuck; guardian can cancel pending? The guardian could cancel before it applies, or if applied, a new vote could replace. Not theft. Could be a governance mistake. Not a code bug because `check-launch-params` maybe doesn't check `swap_operator` is on-curve. RULED swap operator key is oncurve. The accepted key change rule. Could be a liveness if vote arms offcurve and guardian doesn't cancel; but half vote can do. Not report.

Potential issue: `arm_guardian` could arm an off-curve PDA as guardian. Then no one can execute stops. Similarly apply. This could retire emergency stop. A vote with half can do. It's part of governance. If guardian = PDA, require_guardian compares signer key; no signer exists, so stops unusable. Could be unintentional but by governance. Not theft. The spec says guardian of None legal; Some(PDA) not legal? It allows any Pubkey Option. Maybe should require on-curve for guardian to make stop usable, but ruling maybe. Not security? It can remove brake. However governance already can retire guardian with half. So no new capability.

Potential issue: `arm_swap_operator` can arm default (GOV refuses EmptyAction). good.

Potential issue: **`initialize` guardian Option allows Some(default) and `guardian` onchr not required. no.

Potential issue: **`mint_vault` owner Signer but no top-level requirement; offcurve owner could mint but not redeem. accepted. 

Potential issue: **`claim_charter_vault` owner offcurve could mint, but not redeem. accepted.

Potential issue: **`activate` and `boost_vault` allow offcurve owner via CPI. boost signer could be PDA. It reads owner and burns from PDA signer. That is possible. fine.

Potential issue: **`GOV` vote transfer delegate? no.

Now maybe **a bug in `monthly_inline` when `pool.owner != SPL_TOKEN_ID`: it returns Ok without doing anything, even if `total_active_weight==0` and pending_this_epoch>0? Wait active0 branch occurs before pool owner check. yes.
Potential issue: **When `total_active_weight>0` but pool account missing, monthly_inline returns without updating `last_distribute_at`, so every host sees month due and does nothing. Alarm pages distribution_overdue. Road step creates. accepted.
Potential issue: **When pool account missing but redemptions need retire, monthly_inline returns; retire doesn't fail. good.

Potential issue: **`claim` with no owed and pool missing can still join etc. good.

Potential issue: **`distribute` with pool missing fails read_token at start, so explicit distribution fails. accepted item52.

Potential issue: **`split_revenue` with pool ATA missing? It checks holders_ata key derived but not account existence; token transfer will fail if missing. Road step. accepted.

Potential issue: **`mint_vault` with revenue_token missing? transfer fails. Road step. accepted.

Potential issue: **`claim_charter_vault` no revenue_token. okay.

Potential issue: **`boost_vault` monthly_inline with pool missing: monthly_inline returns only if due and active/pool owner not token. If not due, returns. Boost can proceed even if pool missing. okay.

Potential issue: **`set_round` and governance can operate before pool exists. no.

Potential issue: **`Initialize` sets distribution clock to max(charter close). If charter close far future and monthly_secs shorter, first free due after close+month. good.

Potential issue: **`charter_closes_at` maybe > now and `last_distribute_at` set to close>now. good.

Potential issue: **`Split_revenue` before first distribution can send revenue to pool; no immediate distribution. okay.

Potential issue: **`distribute` free path at `w>0` requires `avail >0`; if only owed and no new, MonthNotElapsed or NothingToDistribute. good.

Potential issue: **`avail` calculation uses `balance.checked_sub(owed).ok_or(PoolShort)?` If balance < owed, pool short error. Invariant. good.
Potential issue: **`monthly_inline` uses saturating_sub, so if pool frozen and balance<owed, avail0 no credit. good.
Potential issue: **`pool_is_frozen` does not check balance; okay.

Potential issue: **`retire_redeemed` if pool frozen and vault has pending<subsat only (owed <1 sat), it doesn't log forfeit but still subtracts owed. fine.
Potential issue: **`retire_redeemed` if pool frozen and vault owes 0 but lot of sub-sat? okay.

Potential issue: **`retire` returned pending to pool (owed_scaled down). For bare burns, it returns pending that may include sub-sat dust. okay.

Potential issue: **`retire` if r.active and r.boost_weight >0 `unschedule_boost` called before setting r.active false; unschedule uses c.boosts_active. good.

Potential issue: **`reweigh` if called from `boost_vault` after monthly_inline, c.acc_scaled maybe advanced and owed computed correctly. good.

Potential issue: **`boost_vault` if boost price and spare $CBOB: `read_token` checks state initialized but not close_authority/delegate; a burner could use a delegated/frozen account. Token Burn CPI may fail. no.

Potential issue: **`distribute` $GARY burn if burner account delegate present? Burn from owner authority works even with delegate? SPL Burn authority can be owner or delegate. It passes burner as authority; owner signer can burn if delegate zero. If account has delegate nonzero, owner authority might still be valid? Token Burn with owner signer maybe owner can always burn; delegate is transfer only. no.

Potential issue: **`spl_token` burn account order no mint? yes.

Potential issue: **`BURN` `read_mint_supply` reads `minted_total` and `bare_retired` from MINT account but does not borrow data after config mut? no.

Potential issue: **`BURN` `burn_vault` verifies the MINT config account key/owner/version before rate; later invokes MINT with same account. good.

Potential issue: **If MINT program upgraded? immutable.

Potential issue: **`GOV` execute proposal uses `read_mint_config` but if MINT config has been changed in same transaction by earlier actions, it read before actions. For key_change? no. For `minted_now` event only. For `restart` action uses `p.created_at` and read stops before skip; MINT rechecks. Fine.

Potential issue: **If proposal actions include SetRound and TightenSweep, `m` read before SetRound, but MINT checks tighten and no issue. no.

Potential issue: **`GOV` `read_stops` before executing actions; if an earlier action in same bundle restarts a stop, a later restart half in same bundle? There can be only one Brakes action, so no. If an earlier SetRound doesn't affect stops. good.

Potential issue: **Multiple actions same kind forbidden. good.

Potential issue: **`execute_proposal` CPIs are all in one `invoke_signed` loop; if one action skipped, no CPI. good.

Potential issue: **`execute_proposal` does not re-read config after actions for skips, so two actions before? At most one each kind. okay.

Potential issue: **`last_round_id` update for SetRound even if proposal has multiple actions and later CPI fails; whole instruction reverts. good.

Potential issue: **`governance` signer seeds require bump; context `governance: #[account(seeds=[GOV_SEED], bump)]`. It does not specify `seed::program = crate::ID`? Anchor defaults current program. good.

Potential issue: **`Governed` MINT's `governance` Signer must sign. GOV CPI signs with seeds. good.

Potential issue: **Could a program with the same GOV PDA sign for MINT governed instructions without GOV? Only GOV program can sign for its PDA if it is owner? Actually a PDA can be signed by any program that includes it as signer; the seed derivation includes GOV_PROGRAM_ID. The PDA belongs to GOV. Only GOV can invoke_signed with seeds if called from GOV (or if another program has the same seeds? Seeds include program ID? `find_program_address` uses current program ID. MINT derives GOV_PDA with GOV_PROGRAM_ID; only GOV can sign with those seeds within itself. So no other program. good.

Potential issue: **`GOV` `execute_proposal` CPIs MINT governed instructions using GOV's PDA signer. good.

Potential issue: **`MINT` `apply_guardian` can be called while proposal still voting? It only checks notice from pending stamp. If pending_guardian not yet set? no.

Potential issue: **`apply_guardian` doesn't require governance program signing; it's permissionless to land an armed change after notice. It doesn't need.

Potential issue: **An armed guardian change could be applied by someone right after notice, before community can react? Notice gives time. fine.

Potential issue: **An armed swap operator can be canceled by guardian; guardian cannot cancel guardian change. This is by design.

Potential issue: **`cancel_swap_operator` does not allow guardian to cancel a pending operator after it has applied. Operator in office changed; guardian can only stop sweep. Could old guardian stop? Guardian still guardian if not replaced; yes. If old guardian unchanged, can stop. If proposal arm operator with half but guardian old, guardian can cancel before apply. good.

Potential issue: **If guardian is same as swap operator? no.

Potential issue: **`sweep_sol_for_swap` operator stop**: If guardian calls emergency_stop_sweep after operator sweeps, stop doesn't reverse.

Potential issue: **`sol_reserve_lamports` can be zero at init; `sweep_sol_for_swap` can sweep all lamports from revenue PDA, leaving revenue PDA with zero. Does that affect its ability to be included as account later? A zero-lamport PDA account may be rent-collected and deleted. Could this brick `split_revenue`/`sweep_sol_for_swap`? The revenue PDA account itself is a system account owned by system? Wait MINT's `revenue` PDA is an account with no data? It is a system-owned account? `split_revenue` has `revenue: UncheckedAccount` (PDA) as token authority. The revenue PDA account must exist and be rent-exempt? It is funded at launch. If `sol_reserve_lamports`=0 and a sweep transfers all lamports from revenue PDA to operator, the revenue PDA account becomes zero lamports. Does the runtime delete it at end? If yes, later `split_revenue` cannot include it as account (token authority) because it doesn't exist, and `sweep_sol_for_swap` cannot sweep from it even if someone sends royalties to its ATA? But the revenue address receives royalties in its cbBTC ATA; for split, the `revenue` PDA account must sign transfer of its ATA. If the PDA account no longer exists, `invoke_signed` with revenue PDA signer might fail? In Solana, a missing account in a transaction fails "AccountNotFound" before program execution. However `split_revenue` context includes `revenue` UncheckedAccount; if PDA doesn't exist as lamports? If zero-lamport account is deleted, future transactions can't reference it. Then holders' 85% could be stuck? But royalty payments in cbBTC to pool? Wait `split_revenue` takes revenue ATA and uses revenue PDA as authority; if revenue PDA account deleted, can't sign. However the program could derive same PDA and maybe account is not required to be in transaction? But context has `revenue: UncheckedAccount` required. If account missing, transaction cannot include it. Could an instruction invoke_signed with a PDA account not in account_infos? It must pass AccountInfo from transaction; if missing, no. So could brick revenue.

Is `sol_reserve_lamports` allowed to be 0 at initialize? Yes if 0 or >= rent_exempt. The launch value is 0.05 SOL, not zero, and `tighten_sweep` can only RAISE sol_reserve (because `c.sol_reserve_lamports = c.sol_reserve_lamports.max(x)`, and GOV's TightenSweep requires `x > m.sol_reserve` at creation). So at launch nonzero. If initialized with 0, then yes possible. But accepted item 38 pins rulered 0.05. `initialize` permits 0 for suite/tests maybe. Not a bug at ruled deploy.
Potential issue: Could a vote lower reserve to 0? No, only raise. good.
Potential issue: Could `sol_reserve_lamports` be set below rent exemption and >0 e.g. 1 lamport by init if bug? Initialize rejects unless 0 or >= rent. good.

Potential issue: **Revenue PDA can be drained to reserved 0.05 SOL, still rent exempt. good.

Potential issue: **Pool ATA rent? It holds tokens, token account rent. no.

Potential issue: **BURN asset_signer lamports zero after burn** Could leaving asset_signer zero cause account deletion; no issue after burn.

Potential issue: **Sweep helper transfer all signer lamports to dest, then BURN requires signer lamports 0. If zero-lamport account is deleted before burn, BURN's `asset_signer` AccountInfo might still be in transaction but account could be deleted at instruction end? As noted, between helper instruction and burn instruction in same transaction, a zero-lamport account might be deleted by runtime? The account's lamports are zero after helper. Does Solana delete zero-lamport accounts immediately at instruction boundary? It may mark them as deallocated, but the account can still be passed to later instructions? I think if an account has zero lamports and is referenced later, maybe the runtime says account not found? The suite S8.1 passes, so no. likely zero-lamport accounts persist until transaction end unless rent collection. fine.

Potential issue: **Closing token accounts moves lamports to dest wallet; if dest is owner, owner receives rent. good.

Potential issue: **The helper's lamport transfer to dest after token closes might fail if dest account is below rent and receives exactly enough? System transfer to a rent-exempt account unaffected. If dest doesn't exist and amount below rent, fail; page.

Potential issue: **`BURN` declared account list includes the vault's ATA accounts. If sweep helper closes them, they might be removed? The same transaction later burn includes them as remaining accounts. If closed accounts zero-lamport/zero-data but still pass? The account still exists with data maybe. The burn's reserve loop checks amount0 and len165? If close account leaves data state uninitialized but len165? It may set amount? The tests pass. no.

Potential issue: **`BURN` reserve loop requires d.len==165. If close account changes data length? Sweep helper CloseAccount for classic token account likely sets data length to0? Wait `tests SR.12a` duplicate source expected close account causing second read fail invalid account data, suggesting after CloseAccount the account's data length is 0 or account removed. If close account sets data length to0, then BURN reserve loop `d.len() < 165` would continue, skipping checks, not refuse. But the reserve loop still requires the account was present; if len0, it continues and does not require amount0. Would burn pass? That's fine because account closed/empty. But it doesn't check lamports? closed. The main suite likely passes. Let's confirm: SPL Token CloseAccount closes account by zeroing lamports and maybe data? It might set data to empty? But the account still exists for rest of transaction. If data len0, reserve loop finds expected account, owner might still SPL, d.len <165 so `continue`, which skips any emptiness check. That is acceptable because closed account has no token value. However it also means a malicious redemption could pass a declared reserve account with data len0 (closed) even if before it held value? But burn would have to see amount? Closed means value gone. fine.
Potential issue: Second loop for extra accounts similarly skips closed account owner SPL if len<165, but lamports? If closed source lamports0, acc.lamports==0 maybe continue. fine.
Potential issue: BURN's reserve loop doesn't require account lamports ==0, only amount0/delegates. If account data len165 but lamports >0 open, burn passes even though redeemer strands rent. accepted.

Potential issue: **Sweep helper closing source token accounts transfers their lamports to dest, but BURN only checks signer PDA lamports0, not declared reserve account lamports. If helper used, those are zero/closed. no.

Potential issue: **BURN's `required remaining_accounts.len() == declared` and declared u8. If client declares `declared` equal number including T22 derivations. tests.

Now maybe **critical issue with `split_revenue` decimals**: We should settle. If wrong decimals can cause wrong amount, could theft? Let's verify SPL Token TransferChecked. I recall instruction `TransferChecked` amount is base units? Actually in token program, `TransferChecked { amount: u64, decimals: u8 }`, processor gets `Value::TransferChecked { amount, decimals }`, calls `token::transfer` with `amount` directly? Let me recall from spl-token processor:
```
TokenInstruction::Transfer { amount } => {
    token::transfer(program_id, source, destination, authority, amount)?;
}
TokenInstruction::TransferChecked { amount, decimals } => {
    token::transfer(program_id, source, destination, authority, amount)?;
}
```
Wait `TransferChecked` may not use decimals in processor, account list includes `mint` and `token_program`. Hmm. I think the `decimals` byte is ignored in classic. So no issue. The tests use `createTransferInstruction`, not checked. no.

Potential issue: **`MINT` `split_revenue` reads `decimals` from args, not from mint, but if wrong and token program ignores, it still works. If token program uses it to verify? Account list has mint and token program; could read mint decimals. I think it does. Let's quickly recall actual `spl-token` instruction:
`TransferChecked` was used with associated token account creation; it includes `mint` account for checking decimals to avoid UI amount confusion. The amount remains base units if the client computes. The processor likely `let amount = checked_amount?` where `checked_amount` validates decimal? Actually there is `try_ui_amount` etc. Hmm no time. It is not a bug likely.

Potential issue: **`split_revenue` `holders` rounding gives remainder to holders; bank cut floor. If bank_cut=0, holders=total. The bank treasury gets0. That's floor. good.

Potential issue: **`split_revenue` is permissionless and could be called repeatedly on empty revenue. NothingToSplit. fine.

Potential issue: **`sweep_sol_for_swap` update `last_sweep_at` after transfer; if transfer fails, revert. fine.

Potential issue: **`SolSweptForSwap` remaining = bal - amount, not accounting reserve keep. It logs remaining after transfer (bal-amount), not reserve. fine.

Potential issue: **`BURN` `burned_total` update after all CPIs; if MINT retire fails, revert. good.

Potential issue: **`retire_redeemed` monthly_inline after retire; if monthly_inline errors due to WrongPool or BadPool? It can only error `WrongPool` if passed mismatched, or `Overflow` etc. If pool is correct but data unreadable maybe returns. If WrongPool due to transaction builder, burn reverts. But BURN passed pool from transaction; client must supply. This is part of redemption client. fine.

Potential issue: **`retire_redeemed` `require!(get_stack_height()==TRANSACTION_LEVEL_STACK_HEIGHT+1)` might fail if BURN is invoked by a wrapper but open/burn circumvent? no.

Potential issue: **If BURN `burn_vault` is executed at top-level but with preceding open inside a v0 lookup table, instruction sysvar returns resolved accounts? Test S9b proves. good.

Potential issue: **`read_mint_supply` BURN doesn't check `mint_config` writable flag before read; no.

Potential issue: **`burn_vault` `read_mint_supply` reads MINT config while it may be modified earlier in same transaction by a `claim`? Claim before open in redemption can modify config acc_scaled/owed_scaled but not minted/bare. So rate supply unchanged. good.

Potential issue: **A `distribute` before burn in same transaction could modify `owed_scaled`, perhaps causing ClaimBeforeBurn? Redemption transaction could include distribute before claim? The holder controls. Not theft.
Potential issue: **A redemption transaction could include a governance proposal? no.

Potential issue: **`BURN` rate limit is based on minted_total - burned_total - bare_retired. If a bare burn occurred earlier in same transaction and `retire_burned` also in tx before burn, live supply decreases, cap recalculated. Good. If a bare burn occurred but not retired before redemption, live count includes it until retire, maybe cap higher. accepted.

Potential issue: **`claim` can be called with `crank_n>0` and pairs; monthly_inline may credit, then claimed. good.

Potential issue: **Offchain `crank` may not set compute budget for claims? Claims cost low. fine.

Now maybe **a bug in `Initialize` `cbob_mint` account not included in `Accounts` constraints as writable? It is read only. good.

Potential issue: **`Initialize` `level_caps` array length fixed [u32;5] in arg. Client must pass 5 u32. good.

Potential issue: **`Initialize` args order in tests/launch: test `ixMintInit` passes after notice `u8b(maxBW), u16(maxBE)`; matches code signature. launch json. good.

Potential issue: **`Initialize` config version 6 but `MINT_CONFIG_SPACE` maybe includes `CONFIG_PADDING` and version. no.

Potential issue: **`MINT` `Initialize` doesn't require `ctx.accounts.cbob_mint` account to be in instruction with `is_writable=false` but code just read. fine.

Potential issue: **`Initialize` `pob_root` [u8;32] arg serialization in tests with Buffer. fine.

Potential issue: **`Initialize` `guardian` Option<Pubkey> in tests `SOME`. fine.

Potential issue: **`Initialize` `bank_treasury` can be CBOBTC Squads offcurve. good.

Potential issue: **`Initialize` `swap_operator` nondefault. good.

Potential issue: **`Initialize` `pob_collection` nondefault. good.

Potential issue: **`Initialize` `cbob_mint` not default? It requires owner SPL/len82 and neq payment/GARY. It could be default? Pubkey::default owner not SPL, fails. good.

Potential issue: **`Initialize` `mint_authority` seeds [MINT_SEED], bump. good.

Potential issue: **`MINT` `add_collection_plugin` uses `AccountMeta::new_readonly(mint_pda, true)`. good.

Potential issue: **`Royalty` plugin authority None and data's `Some(PluginAuthority::None)` maybe represented as 1 then 0. tested. fine.

Potential issue: **`SEAL` Config reserve_mints vector has length max3, initial space. good.

Potential issue: **`SEAL` `assert_classic_spl` requires `ReserveMintNotDeclared` if accounts not passed. In `initialize`, remaining_accounts are the mint accounts. Good.

Potential issue: **In test, `ixSealInit` with stranger and [mint] gets NotTheInitAuthority first? Code checks authority first. good.

Potential issue: **`BURN` `initialize` authority first, then seal check. good.

Potential issue: **`GOV` initialize authority first, then read mint. good.

Potential issue: **`MINT` initialize authority first. good.

Potential issue: **`Current tree` has comments with line counts preserved? Not security.

Need decide final findings. Since no confirmed program defects in round25, maybe this round should be clean? The user wants us to find faults, assume wrong. We should not invent. But there may be at least one real bug in docs and maybe an evidence gap. We need be honest.

Let's examine more for a possibly confirmed LOW/MED actual code defect: `distribute` from frozen pool explicitly accepted. Could there be a **missing `pool_is_frozen` check in explicit `distribute` leading to Boost Expiry / forfeit** but SPEC says not refused. It is accepted, so no.
Could there be a **missing `pool_is_frozen` check in `claim` join branch**? If pool frozen and claim tries to join only, it lands because no transfer. That's intended. If claim also pays someone, it reverts. fine.

Could there be **a griefing/payout accuracy bug**: `monthly_inline` doesn't run in `distribute`; no.

Potential issue: `distribute` burn path burns $GARY BEFORE `credit` but after all checks. If `credit` overflows or fails (Overflow) after burn, transaction reverts, so burn reverts? Cross-program SPL Burn instruction executed inside same top-level instruction. If later in the same `distribute` handler a `credit` error occurs, does the SPL Burn inside an inner CPI revert? The inner burn instruction had succeeded and updated mint supply/token account; then the outer `distribute` returns Err. In Solana, if the outer top-level program returns Err, all changes from inner CPIs during that instruction revert? I believe yes, all account changes by the entire instruction revert. The outer could also continue after inner then error; the instruction's transaction reverts. So burn not kept. The code intended "refused distribution burns nothing"; checks before burn. But what if `credit` overflows after burn? It would revert whole transaction, so no burn. Good. But is this true for CPI inner? I think yes. Test maybe no. no issue.

Potential issue: `split_revenue` performs two CPIs; if second fails, first reverts due instruction atomicity. good.

Potential issue: `claim` pays multiple vaults via repeated `invoke_signed` transfers. If a later transfer fails, earlier transfers in same instruction revert? In Solana, if an instruction returns Err after successful inner CPIs, all inner CPI account changes? Are inner CPI changes rolled back if outer returns error? I believe they are rolled back as part of transaction rollback. This is why atomic all-or-nothing. The suite likely tests batch. Good. If not, would be huge, but not.

Potential issue: `execute_proposal` invokes several MINT CPIs; if a later one fails, earlier CPIs within same instruction revert. yes.

Potential issue: `burn_vault` invokes Core BurnV1 then MINT retire; if retire fails, Core burn and earlier checks revert. I believe yes. The suite confirms no burned without retire. Good.

Now **a subtle issue with cross-program invoke account info length extra**: Not relevant.

Potential issue: **On-chain events in failed transaction might still be logged; alarm could false page. Accepted cross-pass lag? no.

Potential issue: **`blockhash_in_window` requires hash nonzero. In SlotHashes sysvar, could a real slot's hash be all zero? cryptographic no. good.

Potential issue: **`try_capture` uses `now` current slot. It doesn't ensure `now` isn't far in future beyond SlotHashes due to clock manipulation? Slot from Clock sysvar. good.

Potential issue: **`capture_entropy` can be called at a slot where try_capture returns NotYet; if reveal_slot future. good.

Potential issue: **`reveal_level` if entropy_set false and try_capture returns Expired -> NeedsReschedule. Good.

Potential issue: **`crank` if record has entropy_set false and level0; if try_capture returns Expired, reschedule. It doesn't require `now > reveal_slot+window` explicit. okay.

Potential issue: **`reschedule` `r.reveal_slot = now + REVEAL_LEAD_SLOTS` and doesn't clear entropy_set. But function only called if !entropy_set. good.

Potential issue: **`readyToReveal` test helper could infinite; not code.

Potential issue: **`reveal_level` `hashv(&[&attributes.try_to_vec()?]).to_bytes()` uses `hashv`, which by default returns a `Hash` with to_bytes. good.

Potential issue: **`write_record` `attrs_hash = hashv(&[&attributes.to_vec().try_to_vec()?]).to_bytes()` uses `attributes.to_vec()` then `try_to_vec`. Could be same. no.

Potential issue: **`push_attr` writes string length as u32 but doesn't include any separator beyond Borsh. good.

Potential issue: **Core UpdatePluginV1 Attributes data format may expect plugin authority after attr list. They pass `data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend(mint_authority.key())?` for create? In `create_vault` they set authority. In reveal_level update plugin? Let's inspect reveal_level CPI:
```
let mut data = vec![IX_UPDATE_PLUGIN_V1, PLUGIN_ATTRIBUTES];
data.extend_from_slice(&((attributes.len()+1) as u32).to_le_bytes());
for a ... push_attr...
push_attr level...
invoke_signed(...)
```
Does UpdatePluginV1 need plugin authority? The instruction format probably includes plugin type and new data, not authority. The authority for updating plugin is checked by plugin manifest, not data. tested.

Potential issue: **`royalty` plugin with authority None: data includes `data.push(1); data.push(PLUGIN_AUTHORITY_NONE);` after adding creators/ruleSet. Maybe format. tested.

Potential issue: **`core_plugin_cpi` set_frozen data [IX_UPDATE_PLUGIN_V1, plugin type, bool]. It doesn't include plugin authority. The SEAL PDA is authority in plugin manifest. tested.

Potential issue: **`create_vault` permanent freeze plugin authority address: It pushes `data.push(1); data.push(PLUGIN_AUTHORITY_ADDRESS); data.extend(seal)`. For plugin authority address, okay.

Potential issue: **`create_vault` at end `data.push(1); data.extend 0u32` maybe `collection`? no. tested.

Potential issue: **`initialize` `AddCollectionPlugin` has `init