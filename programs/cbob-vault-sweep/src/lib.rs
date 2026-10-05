//! THE SWEEP-AT-EXECUTION HELPER (Gary, 2026-10-05, round 24 A3).
//!
//! A redemption is one transaction: SEAL opens the vault, the claim pays its
//! share in, the vault is emptied, BURN proves it empty and burns it. Until now
//! the emptying moved amounts the redeem page read a moment BEFORE sending, so
//! anything landing in between (a stranger's dust, a payout, a lamport deposit)
//! left something behind and BURN refused. A stranger willing to pay fees could
//! repeat that and delay one holder's opening indefinitely.
//!
//! This program moves what is there AT THE MOMENT IT RUNS. The redeem page calls
//! it through Metaplex Core's `ExecuteV1`, which only the asset's owner can sign
//! and in which Core signs as the vault's asset-signer PDA. For each token account
//! named, it reads the live balance, transfers all of it to the destination's
//! account for the same mint, and closes the source (its rent to the destination
//! wallet); then it sends every lamport the vault wallet holds to the destination
//! wallet. Inside one atomic transaction nothing can land between this and the
//! burn, so a deposit cannot block an opening any more.
//!
//! STATELESS, OWNERLESS, NOTHING TO CONFIGURE. It changes none of the four vault
//! programs (BURN's emptiness proof is exactly what it was) and holds no key.
//! Called by anyone directly it can do nothing: the source accounts belong to the
//! asset-signer PDA, which only Core can sign for, and Core signs only for the
//! asset's owner. Every value it moves goes to ONE destination wallet, named once.
//!
//! Accounts: [0] asset signer (signer, writable), [1] destination wallet
//! (writable), [2] the classic SPL Token program, [3] the System program, then
//! (source, destination) token-account PAIRS, both writable.
//! Data: a single byte, 0 (SweepAll). Anything else is refused.
#![allow(unexpected_cfgs)]
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, instruction::{AccountMeta, Instruction},
    msg, program::invoke, program_error::ProgramError, pubkey, pubkey::Pubkey, system_instruction, system_program,
};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process);

pub const SPL_TOKEN_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/// Classic SPL token account: mint[0..32] owner[32..64] amount[64..72] state[108].
const TOKEN_ACCOUNT_LEN: usize = 165;
const IX_TRANSFER: u8 = 3;
const IX_CLOSE_ACCOUNT: u8 = 9;

pub fn process(_program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data != [0] { return Err(ProgramError::InvalidInstructionData); }
    if accounts.len() < 4 || (accounts.len() - 4) % 2 != 0 { return Err(ProgramError::NotEnoughAccountKeys); }
    let (signer, dest, token, system) = (&accounts[0], &accounts[1], &accounts[2], &accounts[3]);
    if !signer.is_signer { return Err(ProgramError::MissingRequiredSignature); }
    if *token.key != SPL_TOKEN_ID || *system.key != system_program::ID { return Err(ProgramError::IncorrectProgramId); }
    if signer.key == dest.key { return Err(ProgramError::InvalidArgument); }
    for pair in accounts[4..].chunks(2) {
        let (src, to) = (&pair[0], &pair[1]);
        let (src_mint, src_owner, amount) = read_token(src)?;
        let (to_mint, to_owner, _) = read_token(to)?;
        // The vault's own account, and a destination of the same mint owned by the
        // ONE destination wallet. Nothing else can be named as a source or a target.
        if src_owner != *signer.key { msg!("CBOB_SWEEP refused: source {} is not the vault's", src.key); return Err(ProgramError::IllegalOwner); }
        if to_owner != *dest.key || to_mint != src_mint {
            msg!("CBOB_SWEEP refused: destination {} is not the wallet's account for that mint", to.key);
            return Err(ProgramError::InvalidAccountData);
        }
        if amount > 0 {
            let mut d = vec![IX_TRANSFER]; d.extend_from_slice(&amount.to_le_bytes());
            invoke(&Instruction { program_id: SPL_TOKEN_ID, data: d, accounts: vec![
                AccountMeta::new(*src.key, false), AccountMeta::new(*to.key, false), AccountMeta::new_readonly(*signer.key, true)] },
                &[src.clone(), to.clone(), signer.clone(), token.clone()])?;
        }
        invoke(&Instruction { program_id: SPL_TOKEN_ID, data: vec![IX_CLOSE_ACCOUNT], accounts: vec![
            AccountMeta::new(*src.key, false), AccountMeta::new(*dest.key, false), AccountMeta::new_readonly(*signer.key, true)] },
            &[src.clone(), dest.clone(), signer.clone(), token.clone()])?;
        msg!("CBOB_SWEEP token mint={} amount={}", src_mint, amount);
    }
    // EVERY LAMPORT the vault wallet holds, read now. A system account with no
    // data may be emptied to zero.
    let lamports = signer.lamports();
    if lamports > 0 {
        invoke(&system_instruction::transfer(signer.key, dest.key, lamports), &[signer.clone(), dest.clone(), system.clone()])?;
    }
    msg!("CBOB_SWEEP lamports={}", lamports);
    Ok(())
}

/// (mint, owner, amount) of a classic SPL token account, or refuse.
fn read_token(a: &AccountInfo) -> Result<(Pubkey, Pubkey, u64), ProgramError> {
    if *a.owner != SPL_TOKEN_ID { return Err(ProgramError::IllegalOwner); }
    let d = a.try_borrow_data()?;
    if d.len() != TOKEN_ACCOUNT_LEN { return Err(ProgramError::InvalidAccountData); }
    let pk = |o: usize| Pubkey::new_from_array(d[o..o + 32].try_into().unwrap());
    Ok((pk(0), pk(32), u64::from_le_bytes(d[64..72].try_into().unwrap())))
}
