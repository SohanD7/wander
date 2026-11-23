// Node-only credential loading. Import from server code, never from src/ or Vite config.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

export const projectRoot = fileURLToPath(new URL('../', import.meta.url))
export const privateZeroSettleConfig = path.join(projectRoot, '.env.zerosettle.local')
export function loadZeroSettleEnv({ root = projectRoot, env = process.env } = {}) {
  // Existing process values win, then the private configuration, then the API-key file.
  for (const name of ['.env.zerosettle.local', '.env.zeroSettke', '.env.zeroSettle']) {
    const file = path.join(root, name)
    if (!fs.existsSync(file)) continue
    let values
    try { values = parseEnv(fs.readFileSync(file, 'utf8')) } catch {
      throw new Error('Cannot load private ZeroSettle environment file')
    }
    for (const [key, value] of Object.entries(values)) {
      if (key.startsWith('ZEROSETTLE_') && env[key] === undefined) env[key] = value
    }
  }
  return env
}
loadZeroSettleEnv()
