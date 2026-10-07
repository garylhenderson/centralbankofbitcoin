// `fs` is imported by scripts/check-launch-params.mjs for its command-line use
// only. Any call in the browser is a defect, so it throws.
const no = () => { throw new Error('fs is not available in the browser') }
export const readFileSync = no
export default { readFileSync }
