//! CBOB ID PLACEHOLDER. Occupies a program id (and its ProgramData address)
//! before launch so nobody can block the deploy by pre-funding those addresses.
//! It holds nothing, creates nothing and refuses every instruction. At launch it
//! is upgraded to the audited bytes, verified, and the upgrade authority removed.
use solana_program::{account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, msg, program_error::ProgramError, pubkey::Pubkey};
entrypoint!(process);
fn process(_: &Pubkey, _: &[AccountInfo], _: &[u8]) -> ProgramResult {
    msg!("CBOB placeholder: not launched; every instruction is refused");
    Err(ProgramError::Custom(0))
}
