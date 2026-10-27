import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { startServer } from './relay.mjs'

const opened = []
afterEach(async () => {
  for (const c of opened.splice(0)) c()
})

function client(port, room) {
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(`ws://127.0.0.1:${port}/sync`, room, doc, { WebSocketPolyfill: WebSocket, disableBc: true })
  opened.push(() => { provider.destroy(); doc.destroy() })
  const synced = new Promise((res) => (provider.synced ? res() : provider.once('synced', res)))
  return { doc, provider, synced }
}
const until = async (fn, ms = 4000) => {
  const t = Date.now()
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe('wander sync server', () => {
  it('relays edits and presence between two clients, and persists across a restart', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-test-'))
    let srv = await startServer({ port: 0, host: '127.0.0.1', dataDir, staticDir: '/nonexistent', persistMs: 50, quiet: true, handleSignals: false })

    const a = client(srv.port, 'trip-1')
    const b = client(srv.port, 'trip-1')
    await Promise.all([a.synced, b.synced])

    a.doc.getMap('votes').set('w|o|alice', 1)
    await until(() => b.doc.getMap('votes').get('w|o|alice') === 1)
    b.doc.getMap('votes').set('w|o|bob', 2)
    await until(() => a.doc.getMap('votes').get('w|o|bob') === 2)

    a.provider.awareness.setLocalStateField('user', { name: 'Alice' })
    await until(() => [...b.provider.awareness.getStates().values()].some((s) => s.user?.name === 'Alice'))

    // rooms are isolated
    const other = client(srv.port, 'trip-2')
    await other.synced
    expect(other.doc.getMap('votes').size).toBe(0)

    // restart the server: a brand-new client must get the saved state from disk
    await new Promise((r) => setTimeout(r, 150))
    await srv.close()
    opened.splice(0).forEach((c) => c())
    srv = await startServer({ port: 0, host: '127.0.0.1', dataDir, staticDir: '/nonexistent', quiet: true, handleSignals: false })
    const c = client(srv.port, 'trip-1')
    await c.synced
    expect(c.doc.getMap('votes').toJSON()).toEqual({ 'w|o|alice': 1, 'w|o|bob': 2 })
    await srv.close()
  })

  it('serves the web build with an SPA fallback and a health check', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-data-'))
    const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-web-'))
    fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>app</title>')
    const srv = await startServer({ port: 0, host: '127.0.0.1', dataDir, staticDir, quiet: true, handleSignals: false })
    const base = `http://127.0.0.1:${srv.port}`
    expect((await (await fetch(`${base}/health`)).json()).ok).toBe(true)
    const deep = await fetch(`${base}/t/some-trip`)
    expect(deep.status).toBe(200)
    expect(await deep.text()).toContain('<title>app</title>')
    const trav = await fetch(`${base}/..%2f..%2fetc/passwd`)
    expect(await trav.text()).toContain('<title>app</title>')
    await srv.close()
  })
})
