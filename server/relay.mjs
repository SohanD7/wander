// Wander backend: one small Node service that (1) relays live Yjs documents over WebSockets,
// (2) persists each trip's document to disk, and (3) serves the built web app from the same origin,
// so a single deploy gives you the app, the sync, and working invite links.
//
//   npm run dev:sync        → sync only, :1234 (use with `vite` for development)
//   npm run build && npm start → app + sync on one port (what you deploy)
//
// Env: PORT (1234) · HOST (0.0.0.0) · DATA_DIR (./data; mount a volume here in production)
//      STATIC_DIR (./dist, served if it exists) · ALLOWED_ORIGINS (comma list; empty = allow all)
//      MAX_ROOMS (500) · PERSIST_MS (800)
// Wire protocol: y-websocket (Yjs 13). Clients connect to  /sync/<room>  (or /<room> for local dev).
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const MSG_SYNC = 0
const MSG_AWARENESS = 1

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
}

export function startServer(opts = {}) {
  const HOST = opts.host ?? process.env.HOST ?? '0.0.0.0'
  const PORT = Number(opts.port ?? process.env.PORT ?? 1234)
  const DATA_DIR = path.resolve(opts.dataDir ?? process.env.DATA_DIR ?? './data')
  const STATIC_DIR = path.resolve(opts.staticDir ?? process.env.STATIC_DIR ?? './dist')
  const ALLOWED = (opts.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const MAX_ROOMS = Number(opts.maxRooms ?? process.env.MAX_ROOMS ?? 500)
  const PERSIST_MS = Number(opts.persistMs ?? process.env.PERSIST_MS ?? 800)
  const quiet = opts.quiet ?? false
  const log = (...a) => !quiet && console.log(...a)

  fs.mkdirSync(DATA_DIR, { recursive: true })
  const hasStatic = fs.existsSync(path.join(STATIC_DIR, 'index.html'))

  /** @type {Map<string, Room>} */
  const rooms = new Map()
  const fileFor = (name) => path.join(DATA_DIR, crypto.createHash('sha256').update(name).digest('hex').slice(0, 32) + '.ydoc')

  /** Write a room's full state atomically (tmp file + rename). */
  function persistNow(room) {
    clearTimeout(room.persistTimer)
    room.persistTimer = undefined
    if (!room.dirty) return
    room.dirty = false
    const file = fileFor(room.name)
    try {
      fs.writeFileSync(file + '.tmp', Y.encodeStateAsUpdate(room.doc))
      fs.renameSync(file + '.tmp', file)
    } catch (err) {
      room.dirty = true
      console.error('persist failed', room.name, err.message)
    }
  }
  function schedulePersist(room) {
    room.dirty = true
    if (!room.persistTimer) room.persistTimer = setTimeout(() => persistNow(room), PERSIST_MS)
  }

  function getRoom(name) {
    let room = rooms.get(name)
    if (room) return room
    if (rooms.size >= MAX_ROOMS) return null
    const doc = new Y.Doc()
    try {
      const saved = fs.readFileSync(fileFor(name))
      Y.applyUpdate(doc, new Uint8Array(saved))
    } catch { /* new room */ }
    const awareness = new awarenessProtocol.Awareness(doc)
    awareness.setLocalState(null)
    room = { name, doc, awareness, conns: new Map(), dirty: false, persistTimer: undefined }
    rooms.set(name, room)

    doc.on('update', (update) => {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_SYNC)
      syncProtocol.writeUpdate(enc, update)
      broadcast(room, encoding.toUint8Array(enc))
      schedulePersist(room)
    })
    awareness.on('update', ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed)
      if (origin && room.conns.has(origin)) {
        const ids = room.conns.get(origin)
        added.forEach((id) => ids.add(id))
        removed.forEach((id) => ids.delete(id))
      }
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MSG_AWARENESS)
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed))
      broadcast(room, encoding.toUint8Array(enc))
    })
    return room
  }

  function send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(msg, (err) => err && ws.close())
  }
  function broadcast(room, msg) {
    room.conns.forEach((_, ws) => send(ws, msg))
  }

  // ---- HTTP: health + static SPA --------------------------------------------------------------
  function serveStatic(req, res) {
    const url = new URL(req.url ?? '/', 'http://x')
    let rel = decodeURIComponent(url.pathname)
    let file = path.join(STATIC_DIR, path.normalize(rel))
    if (!file.startsWith(STATIC_DIR)) { res.writeHead(403).end('forbidden'); return }
    let isAsset = true
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // SPA fallback so /t/<trip> deep links (invite links) load the app
      file = path.join(STATIC_DIR, 'index.html')
      isAsset = false
    }
    const ext = path.extname(file)
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': isAsset && rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    fs.createReadStream(file).pipe(res)
  }

  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0]
    if (pathname === '/health') {
      let connections = 0
      rooms.forEach((r) => (connections += r.conns.size))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, connections }))
      return
    }
    if (hasStatic && (req.method === 'GET' || req.method === 'HEAD')) return serveStatic(req, res)
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('wander sync relay')
  })

  // ---- WebSocket sync ------------------------------------------------------------------------
  const wss = new WebSocketServer({
    server,
    maxPayload: 2 * 1024 * 1024,
    verifyClient: ({ origin }) => ALLOWED.length === 0 || !origin || ALLOWED.includes(origin),
  })

  wss.on('connection', (ws, req) => {
    let name = decodeURIComponent((req.url ?? '/').split('?')[0].replace(/^\/(sync\/)?/, '')) || 'default'
    if (name.length > 128) return ws.close(1009, 'room name too long')
    const room = getRoom(name)
    if (!room) return ws.close(1013, 'server busy')
    room.conns.set(ws, new Set())
    ws.binaryType = 'arraybuffer'

    ws.on('message', (data) => {
      try {
        const msg = new Uint8Array(data)
        const dec = decoding.createDecoder(msg)
        const enc = encoding.createEncoder()
        const type = decoding.readVarUint(dec)
        if (type === MSG_SYNC) {
          encoding.writeVarUint(enc, MSG_SYNC)
          syncProtocol.readSyncMessage(dec, enc, room.doc, ws)
          if (encoding.length(enc) > 1) send(ws, encoding.toUint8Array(enc))
        } else if (type === MSG_AWARENESS) {
          awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(dec), ws)
        }
      } catch (err) {
        console.error('bad message', err.message)
      }
    })

    let alive = true
    ws.on('pong', () => (alive = true))
    const ping = setInterval(() => {
      if (!alive) return ws.terminate()
      alive = false
      try { ws.ping() } catch { /* closed */ }
    }, 30_000)

    ws.on('close', () => {
      clearInterval(ping)
      const ids = room.conns.get(ws)
      room.conns.delete(ws)
      if (ids?.size) awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(ids), null)
      if (room.conns.size === 0) {
        // last one out: flush to disk and free the memory (it reloads from disk on the next join)
        persistNow(room)
        setTimeout(() => {
          if (room.conns.size === 0 && rooms.get(name) === room) {
            persistNow(room)
            room.awareness.destroy()
            room.doc.destroy()
            rooms.delete(name)
          }
        }, 30_000).unref()
      }
    })

    // sync step 1 + current presence
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_SYNC)
    syncProtocol.writeSyncStep1(enc, room.doc)
    send(ws, encoding.toUint8Array(enc))
    const states = room.awareness.getStates()
    if (states.size > 0) {
      const e2 = encoding.createEncoder()
      encoding.writeVarUint(e2, MSG_AWARENESS)
      encoding.writeVarUint8Array(e2, awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(states.keys())))
      send(ws, encoding.toUint8Array(e2))
    }
  })

  const flushAll = () => rooms.forEach(persistNow)
  const onSignal = () => { flushAll(); process.exit(0) }
  if (opts.handleSignals !== false) {
    process.on('SIGTERM', onSignal)
    process.on('SIGINT', onSignal)
  }

  return new Promise((resolve) => {
    server.listen(PORT, HOST, () => {
      const port = server.address().port
      log(`wander on http://${HOST}:${port}  (sync ws path /sync/<room>, data ${DATA_DIR}, ${hasStatic ? 'serving ' + STATIC_DIR : 'no web build found — sync only'})`)
      resolve({
        port,
        rooms,
        close: () => new Promise((done) => {
          flushAll()
          wss.clients.forEach((c) => c.terminate())
          server.close(() => done())
        }),
      })
    })
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer()
