//! TEST-ONLY generic CPI forwarder (round 23, F8).
//!
//! accounts[0] is the target program; accounts[1..] are passed through with the
//! signer and writable flags they arrived with; the instruction data is
//! forwarded verbatim unless prefixed with PDASIGN! (owner PDA), PADTAIL!
//! (a u16 count of trailing 'x' bytes synthesized for large-payload tests) or
//! SIGSPDA! (an Autograph update signed by one more of this program's PDAs).
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
    // Round 33 (gate 5): SIGSPDA! u32 n, then a Core UpdatePluginV1 prefix (its
    // bytes up to the Autograph signature vector). Forwards that update with n
    // signatures from this program's PDAs ["autograph", i], empty messages, the
    // n-th PDA signing: one more signer than the list it replaces. Repeating it
    // grows an autograph one stranger at a time past what a transaction carries.
    if data.starts_with(b"SIGSPDA!") {
        if data.len() < 12 { return Err(ProgramError::InvalidInstructionData); }
        let n = u32::from_le_bytes([data[8], data[9], data[10], data[11]]);
        if n == 0 { return Err(ProgramError::InvalidInstructionData); }
        let mut out = data[12..].to_vec();
        out.extend_from_slice(&n.to_le_bytes());
        for i in 0..n {
            let (p, _) = Pubkey::find_program_address(&[b"autograph", &i.to_le_bytes()], program_id);
            out.extend_from_slice(p.as_ref());
            out.extend_from_slice(&0u32.to_le_bytes());
        }
        let idx = (n - 1).to_le_bytes();
        let (last, bump) = Pubkey::find_program_address(&[b"autograph", &idx], program_id);
        let metas = rest.iter().map(|a| AccountMeta { pubkey: *a.key,
            is_signer: a.is_signer || *a.key == last, is_writable: a.is_writable }).collect();
        return invoke_signed(&Instruction { program_id: *target.key, accounts: metas, data: out }, rest,
            &[&[b"autograph", &idx, &[bump]]]);
    }
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
