//! TEST-ONLY generic CPI forwarder (round 23, F8).
//!
//! accounts[0] is the target program; accounts[1..] are passed through with the
//! signer and writable flags they arrived with; the instruction data is
//! forwarded verbatim unless prefixed with PDASIGN! (owner PDA) or PADTAIL!
//! (a u16 count of trailing 'x' bytes synthesized for large-payload tests).
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
    let padded = data.starts_with(b"PADTAIL!");
    let forwarded = if padded {
        if data.len() < 10 { return Err(ProgramError::InvalidInstructionData); }
        let extra = u16::from_le_bytes([data[8], data[9]]) as usize;
        let mut bytes = data[10..].to_vec();
        let len = bytes.len().checked_add(extra).ok_or(ProgramError::InvalidInstructionData)?;
        // Round 32 (gate 5): above the runtime's 10,240-byte CPI limit, so the
        // RUNTIME refuses an oversized forward and the suite measures that limit.
        if len > 20_000 { return Err(ProgramError::InvalidInstructionData); }
        bytes.resize(len, b'x');
        bytes
    } else if signed { data[8..].to_vec() } else { data.to_vec() };
    let (owner, bump) = Pubkey::find_program_address(&[b"owner"], program_id);
    let metas = rest.iter().map(|a| AccountMeta { pubkey: *a.key,
        is_signer: a.is_signer || (signed && *a.key == owner), is_writable: a.is_writable }).collect();
    let ix = Instruction { program_id: *target.key, accounts: metas,
        data: forwarded };
    if signed { invoke_signed(&ix, rest, &[&[b"owner", &[bump]]]) } else { invoke(&ix, rest) }
}
