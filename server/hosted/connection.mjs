import fs from 'node:fs'
import { parseEnv } from 'node:util'

// The relay holds a session advisory lock and listens for writer handoff on the same connection.
// Prefer Neon’s direct connection. Render can still supply a direct URL under DATABASE_URL.
export function hostedDatabaseUrl(env = process.env) {
  let url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL
  if (!url && env === process.env) {
    for (const name of ['.env.local', '.env']) {
      const file = new URL('../../' + name, import.meta.url)
      if (!fs.existsSync(file)) continue
      const local = parseEnv(fs.readFileSync(file, 'utf8'))
      url = local.DATABASE_URL_UNPOOLED || local.DATABASE_URL
      if (url) break
    }
  }
  if (!url) return undefined
  let target
  try {
    target = new URL(url)
  } catch {
    throw Error('Invalid PostgreSQL connection URL.')
  }
  if (/-pooler\./i.test(target.hostname)) {
    throw Error('The hosted relay requires a direct PostgreSQL connection. Set DATABASE_URL_UNPOOLED.')
  }
  // Keep certificate and hostname verification explicit across pg driver upgrades.
  if (target.hostname.endsWith('.neon.tech') && target.searchParams.get('sslmode') === 'require') {
    target.searchParams.set('sslmode', 'verify-full')
    return target.href
  }
  return url
}
