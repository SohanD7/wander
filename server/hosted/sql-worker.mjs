import { workerData } from 'node:worker_threads'
import fs from 'node:fs'
const { options, port, wake } = workerData
let db
try {
  if (options.testDir) {
    const { PGlite } = await import('@electric-sql/pglite')
    db = new PGlite(options.testDir)
  } else {
    const { Client } = await import('pg')
    db = new Client({
      connectionString: options.url,
      connectionTimeoutMillis: 10000,
      statement_timeout: 20000,
    })
    await db.connect()
    const client = db
    client.on('error', () => {
      db = null
    })
    const acquired = await client.query('SELECT pg_try_advisory_lock(238470119) AS ok')
    if (!acquired.rows[0].ok) {
      if (!options.handoff) throw Error('Stop the hosted writer before importing')
      // A Render replacement starts before its predecessor is stopped. Fence the old writer
      // before reading any room. Unfinished transactions roll back when its connection closes.
      await client.query('NOTIFY wander_writer_handoff')
      await client.query('SELECT pg_advisory_lock(238470119)')
    }
    if (options.handoff) {
      client.on('notification', () => {
        db = null
        void client.end().catch(() => {})
      })
      await client.query('LISTEN wander_writer_handoff')
    }
  }
  const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  for (const statement of schema.split(';').filter((s) => s.trim())) await db.query(statement)
} catch {
  db = null
}
port.on('message', async ({ sql, params }) => {
  try {
    const result = await db.query(sql, params)
    port.postMessage({ ok: true, rows: result.rows })
  } catch {
    port.postMessage({ ok: false })
  }
  Atomics.store(wake, 0, 1)
  Atomics.notify(wake, 0)
})
