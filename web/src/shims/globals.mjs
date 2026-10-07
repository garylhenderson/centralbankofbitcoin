// Browser stand-ins for the two node globals the Bank's shared modules use
// (bank/layout.mjs and scripts/check-launch-params.mjs read `Buffer`; the
// latter's command-line branch reads `process.argv`, which must never match).
import { Buffer } from 'buffer'
export { Buffer }
export const process = { argv: [], env: {} }
