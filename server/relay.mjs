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
import twilio from 'twilio'
import { destinationVote, normalizeOption } from './vote-command.mjs'
import { linkMessage } from './link-message.mjs'
import { ensureChecklist, placementWidgets } from '../src/collab/checklists.mjs'
import { recoverFeatureDeliveries } from './pilot-command-feature.mjs'
import { createPilotBudgets, migratePlanningCards } from './zerosettle-budget.mjs'
import { createPilotPlaces } from './zerosettle-places.mjs'
import { createPilotLists, recoverListDeliveries } from './zerosettle-lists.mjs'
import { createPilotPolls, recoverPollDeliveries } from './zerosettle-polls.mjs'
import { correlateLinks } from './pilot-link-correlation.mjs'
import { placeWidget } from '../src/collab/placement.mjs'
import { createWandaClarifications } from './wanda-clarifications.mjs'
import { createZeroSettleAdapter, zeroSettleConfig, zeroSettleSenderId, normalizeHandle, testerNames } from './zerosettle.mjs'
import { createConversationsAdapter } from './twilio-conversations.mjs'
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
  const testMessages = opts.testMessages ?? process.env.LOCAL_TEST_MESSAGES === '1'
  if (testMessages && !['127.0.0.1', '::1'].includes(HOST)) {
    throw new Error('LOCAL_TEST_MESSAGES requires HOST=127.0.0.1 or HOST=::1')
  }
  const zerosettleConfig = opts.zerosettle === undefined ? zeroSettleConfig() : opts.zerosettle
  const displayNames = testerNames(zerosettleConfig?.testerNames)
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
    if (!room.dirty) return true
    room.dirty = false
    const file = fileFor(room.name)
    try {
      if (opts.snapshotStore) { opts.snapshotStore.save(Y.encodeStateAsUpdate(room.doc)); return true }
      fs.writeFileSync(file + '.tmp', Y.encodeStateAsUpdate(room.doc))
      fs.renameSync(file + '.tmp', file)
      return true
    } catch (err) {
      room.dirty = true
      console.error('persist failed', room.name, err.message)
      return false
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
    if (opts.snapshotStore) {
      const saved = opts.snapshotStore.load()
      if (saved) Y.applyUpdate(doc, saved)
    } else try {
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
    doc.transact(() => {
      if (zerosettleConfig && name === `wander-${zerosettleConfig.tripId}`) {
        const members = doc.getMap('members')
        for (const handle of zerosettleConfig.testers.map(normalizeHandle)) {
          const id = zeroSettleSenderId(handle)
          const current = members.get(id)
          const displayName = displayNames[handle] ?? handle
          if (zerosettleConfig.budgets && doc.getMap('pilotRoster').get(id)?.name !== displayName) doc.getMap('pilotRoster').set(id, { id, name: displayName })
          if (current?.name !== displayName) members.set(id, { ...current, id, name: displayName, tone: current?.tone ?? 'sea', status: current?.status ?? 'joined' })
        }
      }
      if (zerosettleConfig?.budgets && name === `wander-${zerosettleConfig.tripId}`) {
        const allowed = new Set(zerosettleConfig.testers.map((handle) => zeroSettleSenderId(normalizeHandle(handle))))
        for (const id of doc.getMap('pilotRoster').keys()) if (!allowed.has(id)) doc.getMap('pilotRoster').delete(id)
      }
      migratePlanningCards(doc)
      recoverFeatureDeliveries(doc)
      for (const w of doc.getMap('widgets').values()) if (w.type === 'checklist') ensureChecklist(doc, w)
      recoverListDeliveries(doc)
      recoverPollDeliveries(doc)
      const acks = doc.getMap('pilotAcknowledgments')
      for (const [id, ack] of acks) {
        if (ack.state === 'sending') acks.set(id, { ...ack, state: 'uncertain', reason: 'relay_restarted' })
      }
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
    let rel
    try {
      rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    } catch {
      res.writeHead(400).end('invalid URL')
      return
    }
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

  // Local pilot ingress. No CORS or proxy-header trust: only direct loopback CLI requests.
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  async function acceptTestMessage(req, res) {
    if (!testMessages) return json(res, 404, { error: 'not found' })
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.headers.origin) {
      return json(res, 403, { error: 'direct loopback CLI requests only' })
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'use POST' })
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
      return json(res, 415, { error: 'use application/json' })
    }
    let body
    try {
      let raw = ''
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 8192) { json(res, 413, { error: 'body too large' }); return }
        raw += chunk.toString('utf8')
      }
      body = JSON.parse(raw)
    } catch { return json(res, 400, { error: 'invalid JSON' }) }
    const response = executePilotMessage(body)
    json(res, response.status, response.body)
  }

  // Shared by the local ingress and all signed provider adapters. One vote/receipt implementation.
  function executePilotMessage(body, { allowBoard = false, allowLinks = false, correlation, acknowledgment, deferredComment, deferredCommentId } = {}) {
    const result = (status, body) => ({ status, body })
    const { messageId, tripId, senderId, text, senderHandle } = body ?? {}
    const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_~.-]{1,120}$/.test(value)
    const validSender = validId(senderId) || (typeof senderId === 'string' && /^\+[1-9]\d{1,14}$/.test(senderId))
    if (![messageId, tripId].every(validId) || !validSender || typeof text !== 'string' || text.length > (allowLinks ? 4000 : 1000)) {
      return result(400, { error: 'invalid message IDs, sender or text length' })
    }
    const board = allowBoard && text.trim().toLowerCase() === 'board'
    const links = allowLinks ? linkMessage(text) : { urls: [], comment: '', voteText: null }
    const optionText = destinationVote(allowLinks ? links.voteText : text)
    if (!board && !optionText && !links.urls.length && !correlation) return result(422, { error: 'supported command: vote for an existing destination or share a link' })
    const name = `wander-${tripId}`
    if (!rooms.has(name) && !fs.existsSync(fileFor(name))) return result(404, { error: 'trip not found' })
    const room = getRoom(name)
    if (!room) return result(503, { error: 'server busy' })
    const meta = room.doc.getMap('meta')
    if (!meta.get('seeded') || meta.get('deleted')) return result(404, { error: 'trip not found' })
    const receipts = room.doc.getMap('pilotMessageReceipts')
    const previous = receipts.get(messageId)
    if (previous && (previous.senderId !== senderId || previous.text !== text)) return result(409, { error: 'messageId already used with different content' })
    let receipt = previous
    if (!receipt) {
      const widgets = room.doc.getMap('widgets')
      let poll, option
      if (optionText) {
        poll = widgets.get(meta.get('destinationPollId'))
        if (poll?.type !== 'vote') return result(422, { error: 'destination poll not configured (meta.destinationPollId)' })
        const options = poll.options.filter((o) => normalizeOption(o.text) === optionText)
        if (options.length !== 1) return result(422, { error: 'destination poll must have exactly one matching existing option' })
        option = options[0]
      }
      receipt = { senderId, text }
      if (board) receipt.command = 'board'
      if (option) Object.assign(receipt, { widgetId: poll.id, optionId: option.id })
      if (links.urls.length) receipt.cardIds = []
      room.doc.transact(() => {
        const comment = deferredComment ?? correlateLinks({ doc: room.doc, messageId, senderId, text, links, context: correlation, receipt })
        if (deferredCommentId) receipt.commentMessageId = deferredCommentId
        if (option) {
          const votes = room.doc.getMap('votes')
          const key = `${poll.id}|${option.id}|${senderId}`
          if (!votes.has(key)) votes.set(key, Date.now())
        }
        const z = Math.max(0, ...[...widgets.values()].map((w) => w.z))
        for (const [index, url] of links.urls.entries()) {
          const id = 'w_link_' + crypto.createHash('sha256').update(`${messageId}|${index}`).digest('hex').slice(0, 24)
          const position = placeWidget(placementWidgets(room.doc, widgets.values()), { type: 'note' })
          widgets.set(id, {
            id, type: 'note', ...position, z: z + index + 1,
            text: url + (comment ? '\n\n' + comment : ''), author: displayNames[senderHandle] ?? senderHandle ?? senderId,
            source: { provider: 'zerosettle', messageId, senderId, url, messageText: text, ...(receipt.commentMessageId ? { commentMessageId: receipt.commentMessageId, commentText: comment } : {}) },
          })
          receipt.cardIds.push(id)
        }
        const fragments = room.doc.getMap('pilotLinkFragments')
        const fragment = fragments.get(messageId)
        if (fragment) fragments.set(messageId, { ...fragment, cardIds: [...(receipt.cardIds ?? [])] })
        if (links.urls.length && acknowledgment) {
          room.doc.getMap('pilotAcknowledgments').set(messageId, {
            chatId: acknowledgment.chatId, state: acknowledgment.enabled ? 'pending' : 'disabled', createdAt: Date.now(),
          })
        }
        receipts.set(messageId, receipt)
      }, 'pilot-message')
    }
    if (!persistNow(room)) return result(503, { error: 'could not persist; retry the same message' })
    const response = { ok: true, duplicate: !!previous, tripId, messageId }
    if (board) response.command = 'board'
    if (receipt.widgetId) {
      const prefix = `${receipt.widgetId}|${receipt.optionId}|`
      response.count = [...room.doc.getMap('votes').keys()].filter((key) => key.startsWith(prefix)).length
    }
    if (receipt.cardIds) response.cardIds = receipt.cardIds
    return result(200, response)
  }

  function acknowledgmentRoom(tripId) {
    const name = `wander-${tripId}`
    return rooms.has(name) || fs.existsSync(fileFor(name)) ? getRoom(name) : null
  }
  const ackStore = {
    pending: (tripId, chatId) => {
      const room = acknowledgmentRoom(tripId)
      if (!room || room.doc.getMap('meta').get('deleted')) return []
      return [...room.doc.getMap('pilotAcknowledgments')].filter(([, a]) => a.state === 'pending' && a.chatId === chatId).map(([id]) => id)
    },
    claim: (tripId, id, chatId) => {
      const room = acknowledgmentRoom(tripId)
      if (!room || room.doc.getMap('meta').get('deleted')) return null
      const acks = room.doc.getMap('pilotAcknowledgments')
      const previous = acks.get(id)
      if (previous?.state !== 'pending' || previous.chatId !== chatId) return null
      acks.set(id, { ...previous, state: 'sending', attemptedAt: Date.now() })
      if (!persistNow(room)) { acks.set(id, previous); return null }
      return previous
    },
    finish: (tripId, id, outcome) => {
      const room = acknowledgmentRoom(tripId)
      if (!room) return
      const acks = room.doc.getMap('pilotAcknowledgments')
      const previous = acks.get(id)
      if (!previous || !['sending', 'uncertain'].includes(previous.state)) return
      acks.set(id, { ...previous, ...outcome, finishedAt: Date.now() })
      persistNow(room) // failure leaves a sending claim on disk: restart must never resend it
    },
  }

  // Programmable Messaging is independently opt-in; Conversations configuration is unchanged.
  const smsPath = '/webhooks/twilio/sms'
  const sms = opts.sms !== undefined ? opts.sms : process.env.TWILIO_SMS_ENABLED === '1' ? {
    authToken: process.env.TWILIO_AUTH_TOKEN,
    webhookUrl: process.env.TWILIO_SMS_WEBHOOK_URL,
    tripId: process.env.TWILIO_SMS_TRIP_ID,
    to: process.env.TWILIO_SMS_TO,
    testers: (process.env.TWILIO_SMS_TESTERS ?? '').split(',').map((v) => v.trim()).filter(Boolean),
  } : null
  const phone = (value) => typeof value === 'string' && /^\+[1-9]\d{1,14}$/.test(value)
  let smsTarget
  if (sms) {
    const url = new URL(sms.webhookUrl)
    if (!sms.authToken || !['http:', 'https:'].includes(url.protocol) || url.pathname !== smsPath ||
        url.hash || url.username || url.password || !/^[a-zA-Z0-9_~.-]{1,120}$/.test(sms.tripId ?? '') ||
        !phone(sms.to) || !Array.isArray(sms.testers) || !sms.testers.length || !sms.testers.every(phone)) {
      throw new Error('Invalid Twilio SMS configuration: token, exact callback URL, trip, To and nonempty E.164 tester allowlist required')
    }
    smsTarget = url.pathname + url.search
  }
  async function acceptSms(req, res) {
    if (!sms) return json(res, 404, { error: 'not found' })
    if (req.method !== 'POST') return json(res, 405, { error: 'use POST' })
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') {
      return json(res, 415, { error: 'use application/x-www-form-urlencoded' })
    }
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 65536) return json(res, 413, { error: 'body too large' })
      chunks.push(chunk)
    }
    const params = Object.create(null)
    for (const [key, value] of new URLSearchParams(Buffer.concat(chunks).toString('utf8'))) {
      if (Object.hasOwn(params, key)) return json(res, 400, { error: 'duplicate form field' })
      params[key] = value
    }
    const signature = req.headers['x-twilio-signature']
    // Authenticate all received fields, using the fixed public URL, before touching a room.
    if (req.url !== smsTarget || typeof signature !== 'string' || !twilio.validateRequest(sms.authToken, signature, sms.webhookUrl, params)) {
      return json(res, 403, { error: 'invalid Twilio signature' })
    }
    if (!phone(params.From) || !sms.testers.includes(params.From) || params.To !== sms.to) {
      return json(res, 403, { error: 'sender or destination not allowed' })
    }
    if (!/^SM[a-fA-F0-9]{32}$/.test(params.MessageSid ?? '') || typeof params.Body !== 'string') {
      return json(res, 400, { error: 'Body and valid SMS MessageSid required' })
    }
    const response = executePilotMessage({
      messageId: params.MessageSid, tripId: sms.tripId, senderId: params.From, text: params.Body,
    })
    if (response.status !== 200) return json(res, response.status, response.body)
    // No Message verb and no REST send: successful votes and replays never generate an SMS reply.
    res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store' })
    res.end('<Response/>')
  }

  const budgets = createPilotBudgets({ config: zerosettleConfig, roomForTrip: acknowledgmentRoom, persistNow, fetchImpl: opts.zeroSettleFetch, hosted: opts.engineOnly })
  const places = createPilotPlaces({ config: zerosettleConfig, roomForTrip: acknowledgmentRoom, persistNow, fetchImpl: opts.zeroSettleFetch, geocodeFetch: opts.geocodeFetch })
  const lists = createPilotLists({ config: zerosettleConfig, roomForTrip: acknowledgmentRoom, persistNow, fetchImpl: opts.zeroSettleFetch })
  const polls = createPilotPolls({ config: zerosettleConfig, roomForTrip: acknowledgmentRoom, persistNow, fetchImpl: opts.zeroSettleFetch })
  const language = createWandaClarifications({ config: zerosettleConfig, roomForTrip: acknowledgmentRoom, persistNow, fetchImpl: opts.zeroSettleFetch })
  const zerosettle = createZeroSettleAdapter({ config: zerosettleConfig, executePilotMessage, ackStore, sendAcknowledgment: opts.sendZeroSettleAcknowledgment, fetchImpl: opts.zeroSettleFetch, polls, lists, budgets, places, language })

  if (opts.engineOnly) {
    const room = getRoom('wander-' + (opts.tripId ?? zerosettleConfig.tripId))
    return {room, ingress: zerosettle, flush: () => persistNow(room), names: displayNames,
      close() { zerosettle.close?.(); persistNow(room); room.awareness.destroy(); room.doc.destroy() }}
  }

  const conversations = createConversationsAdapter({
    config: opts.twilio, executePilotMessage, sendReply: opts.sendTwilioReply,
  })

  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0]
    if (pathname === '/webhooks/zerosettle') {
      zerosettle(req, res).catch(() => {
        if (!res.headersSent) json(res, 500, { error: 'ZeroSettle webhook failed' })
      })
      return
    }
    if (pathname === smsPath) {
      acceptSms(req, res).catch(() => {
        if (!res.headersSent) json(res, 500, { error: 'SMS webhook failed' })
      })
      return
    }
    if (pathname === '/webhooks/twilio/conversations') {
      conversations(req, res).catch(() => {
        if (!res.headersSent) json(res, 500, { error: 'webhook failed' })
      })
      return
    }
    if (pathname === '/local/test-message') {
      acceptTestMessage(req, res).catch((err) => {
        console.error('local test message failed', err.message)
        if (!res.headersSent) json(res, 500, { error: 'test message failed' })
      })
      return
    }
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
    let name
    try {
      name = decodeURIComponent((req.url ?? '/').split('?')[0].replace(/^\/(sync\/)?/, '')) || 'default'
    } catch {
      return ws.close(1008, 'invalid room URL')
    }
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
      zerosettle.resume?.()
      log(`wander on http://${HOST}:${port}  (sync ws path /sync/<room>, data ${DATA_DIR}, ${hasStatic ? 'serving ' + STATIC_DIR : 'no web build found — sync only'})`)
      resolve({
        port,
        rooms,
        close: () => new Promise((done) => {
          zerosettle.close?.()
          flushAll()
          wss.clients.forEach((c) => c.terminate())
          server.close(() => done())
        }),
      })
    })
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.WANDER_GROUP_TRIPS === '1') {
    // Finish evaluating the shared relay before the hosted entry point imports its room engine.
    import('./hosted/service.mjs').then(async ({ startHosted }) => {
      const service = await startHosted({ host: process.env.HOST })
      const stop = () => service.close().then(() => process.exit(0))
      process.once('SIGTERM', stop)
      process.once('SIGINT', stop)
    }).catch(() => {
      console.error('Hosted relay could not start. Check the database connection and server settings.')
      process.exit(1)
    })
  } else startServer()
}
