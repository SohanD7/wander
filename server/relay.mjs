// Minimal in-memory Yjs relay for the prototype (y-websocket wire protocol, Yjs 13).
// No database: each trip's document lives in this process's memory and is gone on restart.
// Run: `npm run dev:sync`  (HOST / PORT env override; defaults 0.0.0.0:1234 so phones on your LAN can join)
import http from 'node:http'
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const MSG_SYNC = 0
const MSG_AWARENESS = 1
const HOST = process.env.HOST ?? '0.0.0.0'
const PORT = Number(process.env.PORT ?? 1234)

/** @type {Map<string, {doc: Y.Doc, awareness: awarenessProtocol.Awareness, conns: Map<import('ws').WebSocket, Set<number>>}>} */
const rooms = new Map()

function getRoom(name) {
  let room = rooms.get(name)
  if (room) return room
  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalState(null)
  room = { doc, awareness, conns: new Map() }
  rooms.set(name, room)

  doc.on('update', (update) => {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MSG_SYNC)
    syncProtocol.writeUpdate(enc, update)
    broadcast(room, encoding.toUint8Array(enc))
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

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('wander sync relay')
})
const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
  const name = decodeURIComponent((req.url ?? '/').slice(1).split('?')[0]) || 'default'
  const room = getRoom(name)
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
      console.error('bad message', err)
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

server.listen(PORT, HOST, () => console.log(`wander sync relay on ws://${HOST}:${PORT}`))
