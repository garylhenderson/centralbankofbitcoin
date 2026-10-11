/** Version guard for the producer's direct external imports. No application code is loaded.
 * This detects version changes, not same-version file edits or transitive dependency drift.
 * A separately locked install remains the stronger isolation boundary.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const pins = JSON.parse(fs.readFileSync(new URL('./public-data-dependencies.json', import.meta.url)))
try {
  if (!Array.isArray(pins) || pins.length !== 3) throw new Error('Invalid dependency pins')
  for (const pin of pins) {
    let dir = path.dirname(fileURLToPath(import.meta.resolve(pin.spec))), found = false
    for (;;) {
      const file = path.join(dir, 'package.json')
      if (fs.existsSync(file)) {
        const pkg = JSON.parse(fs.readFileSync(file))
        if (pkg.name === pin.name) {
          if (pkg.version !== pin.version) throw new Error('Dependency version changed')
          found = true; break
        }
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    if (!found) throw new Error('Dependency metadata missing')
  }
} catch {
  console.error('Public-data dependencies differ from reviewed versions. Refresh refused; review the installed packages before updating the pins.')
  process.exit(1)
}
