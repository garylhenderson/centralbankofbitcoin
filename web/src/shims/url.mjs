// check-launch-params.mjs compares process.argv[1] (empty here) with
// fileURLToPath(import.meta.url); the comparison must simply be false.
export const fileURLToPath = u => (typeof u === 'string' ? u : '')
export default { fileURLToPath }
