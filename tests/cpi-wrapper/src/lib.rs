//! TEST-ONLY generic CPI forwarder (round 23, F8).
//!
//! accounts[0] is the target program; accounts[1..] are passed through with the
//! signer and writable flags they arrived with; the instruction data is
//! forwarded verbatim unless prefixed with PDASIGN! (the owner-PDA test mode).
//! So any instruction the suite can build top-level, it can
//! also send one level down, inside another program, which is exactly the shape
//! the redemption path's top-level and stack-height checks exist to refuse.
use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed}, program_error::ProgramError, pubkey::Pubkey,
};

entrypoint!(process);

fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let (target, rest) = accounts.split_first().ok_or(ProgramError::NotEnoughAccountKeys)?;
    // Test-only owner PDA: prove CPI signers can claim/vote even though they
    // cannot satisfy redemption's separate top-level signature requirement.
    let signed = data.starts_with(b"PDASIGN!");
    let (owner, bump) = Pubkey::find_program_address(&[b"owner"], program_id);
    let metas = rest.iter().map(|a| AccountMeta { pubkey: *a.key,
        is_signer: a.is_signer || (signed && *a.key == owner), is_writable: a.is_writable }).collect();
    let ix = Instruction { program_id: *target.key, accounts: metas,
        data: if signed { data[8..].to_vec() } else { data.to_vec() } };
    if signed { invoke_signed(&ix, rest, &[&[b"owner", &[bump]]]) } else { invoke(&ix, rest) }
}
