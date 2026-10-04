//! TEST-ONLY generic CPI forwarder (round 23, F8).
//!
//! accounts[0] is the target program; accounts[1..] are passed through with the
//! signer and writable flags they arrived with; the instruction data is
//! forwarded verbatim. So any instruction the suite can build top-level, it can
//! also send one level down, inside another program, which is exactly the shape
//! the redemption path's top-level and stack-height checks exist to refuse.
use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, instruction::{AccountMeta, Instruction},
    program::invoke, program_error::ProgramError, pubkey::Pubkey,
};

entrypoint!(process);

fn process(_program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let (target, rest) = accounts.split_first().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let metas = rest.iter().map(|a| AccountMeta { pubkey: *a.key, is_signer: a.is_signer, is_writable: a.is_writable }).collect();
    invoke(&Instruction { program_id: *target.key, accounts: metas, data: data.to_vec() }, rest)
}
