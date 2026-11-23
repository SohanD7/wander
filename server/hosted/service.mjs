import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { WebSocketServer } from 'ws'
import { startServer } from '../relay.mjs'
import { verifyZeroSettleSignature, zeroSettleConfig } from '../zerosettle.mjs'
import { providerMessageId, normalizeHandle, zeroSettleSenderId } from '../zerosettle-protocol.mjs'
import { wandaCommandText } from '../wanda-command.mjs'
import { sendZeroSettleText } from '../zerosettle-ack.mjs'
import { editCanvas } from './edits.mjs'
import { database } from './database.mjs'
import { hostedDatabaseUrl } from './connection.mjs'
import { claims, token, problem } from './claim.mjs'
import { boardView } from './view.mjs'

async function bytes(req) {
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > 65536) throw problem(413, 'Message too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
function parse(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    throw problem(400, 'Invalid JSON')
  }
}
const cookie = (req, key) =>
  (req.headers.cookie ?? '')
    .split('; ')
    .find((c) => c.startsWith(key + '='))
    ?.slice(key.length + 1)
const mask = (h) =>
  h.startsWith('+1') && h.length === 12 ? '(' + h.slice(2, 5) + ') •••-' + h.slice(-4) : '••• ' + h.slice(-4)
const provider = 'https://portal.zerosettle.io/api/imessage'
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
export async function startHosted(opts = {}) {
  const env = opts.env ?? process.env,
    config = zeroSettleConfig(env),
    fetcher = opts.fetch ?? fetch
  const origin = new URL(env.WANDER_PUBLIC_ORIGIN).origin,
    scope = env.ZEROSETTLE_ACCOUNT_SCOPE
  const databaseUrl = opts.testDir ? undefined : hostedDatabaseUrl(env)
  if (
    !config?.webhookSecret ||
    !config.apiKey ||
    !scope ||
    !env.WANDER_CLAIM_KEY ||
    env.WANDER_CLAIM_KEY.length < 32 ||
    (!opts.testDir && !databaseUrl) ||
    (!origin.startsWith('https://') &&
      !(opts.host === '127.0.0.1' && origin.startsWith('http://127.0.0.1:') && opts.fetch))
  )
    throw Error('Incomplete hosted configuration')
  const allowed = new Set(
    (env.ZEROSETTLE_ALLOWED_GROUPS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  if (!allowed.size) throw Error('Configure explicit rollout groups or *')
  const db = database({ url: databaseUrl, testDir: opts.testDir, handoff: opts.handoff ?? true }),
    { query } = db
  const engines = new Map(),
    channels = new Map()
  const groupAllowed = (chat) => allowed.has(chat) || allowed.has('*')
  const transport = (t) => (url, init) => {
    if (init.body) {
      const payload = JSON.parse(init.body)
      if (t.line !== 'single') payload.line_id = t.line
      // Resolve protected-board links only at delivery. Invite secrets stay outside the Yjs snapshot.
      if (payload.chat_id === t.chat && payload.text?.includes(origin + '/t/' + t.id + '#widget-'))
        payload.text = payload.text.split(origin + '/t/' + t.id + '#widget-')[0] + invite(t)
      init = { ...init, body: JSON.stringify(payload) }
    }
    return fetcher(url, init)
  }
  const claim = claims({ query, key: env.WANDER_CLAIM_KEY, transport, config, clock: opts.clock })
  const invite = (t) => origin + '/join/' + t.id + '#' + claim.invitation(t.id)
  const members = (t) => query('SELECT * FROM wander_member WHERE trip=$1 AND active ORDER BY handle', [t.id])
  function profile(m) {
    return (
      m.name ||
      config.testerNames[m.handle] ||
      m.imported_name ||
      (m.handle.startsWith('+') ? 'Member ' + m.handle.slice(-4) : 'Group member')
    )
  }
  function syncNames(t, e) {
    const roster = members(t),
      doc = e.room.doc
    doc.transact(() => {
      const active = new Set()
      for (const m of roster) {
        const id = zeroSettleSenderId(m.handle),
          name = profile(m)
        active.add(id)
        e.names[m.handle] = name
        if (doc.getMap('members').get(id)?.name !== name)
          doc.getMap('members').set(id, { id, name, tone: 'sea', status: 'joined' })
        if (doc.getMap('pilotRoster').get(id)?.name !== name) doc.getMap('pilotRoster').set(id, { id, name })
      }
      for (const id of doc.getMap('pilotRoster').keys())
        if (!active.has(id)) doc.getMap('pilotRoster').delete(id)
    })
  }
  function engine(t) {
    if (engines.has(t.id)) return engines.get(t.id)
    const roster = members(t)
    if (!roster.length) throw problem(403, 'Group membership unavailable')
    const e = startServer({
      engineOnly: true,
      quiet: true,
      tripId: t.id,
      zerosettle: t.line === 'manual' ? null : {
        ...config,
        chatId: t.chat,
        tripId: t.id,
        testers: roster.map((m) => m.handle),
        authorizedSenderId: (id) => members(t).some((m) => zeroSettleSenderId(m.handle) === id),
        memberAllowed: (h) =>
          !!query('SELECT 1 FROM wander_member WHERE trip=$1 AND handle=$2 AND active', [t.id, h]).length,
        testerNames: Object.fromEntries(roster.map((m) => [m.handle, profile(m)])),
        boardBaseUrl: origin,
      },
      zeroSettleFetch: transport(t),
      geocodeFetch: opts.geocodeFetch,
      snapshotStore: {
        load: () => query('SELECT snapshot FROM wander_trip WHERE id=$1', [t.id])[0].snapshot,
        save: (bytes) => query('UPDATE wander_trip SET snapshot=$1 WHERE id=$2', [Buffer.from(bytes), t.id]),
      },
    })
    const doc = e.room.doc
    const meta = doc.getMap('meta')
    doc.transact(() => {
      if (!meta.get('seeded')) {
        meta.set('name', t.title)
        meta.set('seeded', true)
      }
      const widgets = doc.getMap('widgets')
      const starter = widgets.get('w_destination')
      if (
        meta.get('destinationPollId') === 'w_destination' &&
        starter?.question === 'where should we go?' &&
        !starter.nativePoll &&
        starter.options?.map((option) => option.text).join('|') === 'Lisbon|Porto' &&
        !Array.from(doc.getMap('votes').keys()).some((key) => key.startsWith('w_destination|'))
      ) {
        widgets.delete('w_destination')
        meta.delete('destinationPollId')
      }
    })
    engines.set(t.id, e)
    syncNames(t, e)
    if (!e.flush()) throw problem(503, 'Storage unavailable')
    let scheduled = false
    e.room.doc.on('update', () => {
      if (!scheduled) {
        scheduled = true
        queueMicrotask(() => {
          scheduled = false
          for (const c of channels.get(t.id) ?? []) push(c)
        })
      }
    })
    e.ingress.resume?.()
    return e
  }
  async function group(chat, line) {
    const response = await fetcher(provider + '/groups', {
      headers: { Authorization: 'Bearer ' + config.apiKey },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw problem(503, 'Group membership unavailable')
    const groups = (await response.json()).groups
    if (!Array.isArray(groups)) throw problem(503, 'Group membership unavailable')
    const g = groups.find((g) => g.chat_id === chat && (g.line_id ?? 'single') === line)
    if (!g) return []
    if (!Array.isArray(g.participants)) throw problem(503, 'Group membership unavailable')
    return [...new Set(g.participants.map(normalizeHandle).filter((h) => h && h !== normalizeHandle(g.line)))]
  }
  function rosterWrite(t, handles) {
    query('UPDATE wander_member SET active=false WHERE trip=$1 AND active AND NOT(handle=ANY($2::text[]))', [
      t.id,
      handles,
    ])
    const records = handles.map((handle) => ({ handle, picker: randomUUID() }))
    query(
      `INSERT INTO wander_member(trip,handle,picker,active)
      SELECT $1,p.handle,p.picker,true FROM jsonb_to_recordset($2::jsonb) AS p(handle text,picker uuid)
      ON CONFLICT(trip,handle) DO UPDATE SET active=true WHERE NOT wander_member.active`,
      [t.id, JSON.stringify(records)],
    )
    query(
      'DELETE FROM wander_session WHERE trip=$1 AND picker IN (SELECT picker FROM wander_member WHERE trip=$1 AND NOT active)',
      [t.id],
    )
    query(
      "UPDATE wander_challenge SET state='revoked' WHERE trip=$1 AND picker IN (SELECT picker FROM wander_member WHERE trip=$1 AND NOT active)",
      [t.id],
    )
  }
  function transaction(fn) {
    query('BEGIN')
    try {
      const value = fn()
      query('COMMIT')
      return value
    } catch (e) {
      query('ROLLBACK')
      throw e
    }
  }
  async function refresh(t) {
    if (t.line === 'manual') return
    const handles = await group(t.chat, t.line)
    transaction(() => rosterWrite(t, handles))
    const e = engines.get(t.id)
    if (e) syncNames(t, e)
  }
  const sessionName = (t) => 'wander_s_' + t.id
  function push(c) {
    try {
      if (c.ws.readyState !== 1) return
      const m = claim.session(c.cookie, c.t.id)
      if (!m || !m.name) return c.ws.close(1008)
      c.ws.send(JSON.stringify(boardView(engine(c.t).room.doc, zeroSettleSenderId(m.handle))))
    } catch {
      c.ws.close(1011)
    }
  }
  query("UPDATE wander_reply SET state='uncertain' WHERE state='sending'")
  query("UPDATE wander_challenge SET state='uncertain' WHERE state='sending'")
  async function groupReply(t, id) {
    const claimed = query(
      "UPDATE wander_reply SET state='sending' WHERE trip=$1 AND message=$2 AND state='pending' RETURNING message",
      [t.id, id],
    )
    if (!claimed.length) return
    const result = await sendZeroSettleText({
      config,
      chatId: t.chat,
      text: t.title + ' · This group’s active trip: ' + invite(t),
      signal: new AbortController().signal,
      fetchImpl: transport(t),
    })
    query('UPDATE wander_reply SET state=$1 WHERE trip=$2 AND message=$3', [result.state, t.id, id])
  }
  async function webhook(req, res, raw, json) {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json')
      throw problem(415, 'Use application/json')
    if (!verifyZeroSettleSignature(config.webhookSecret, req.headers['x-zerosettle-signature'], raw))
      throw problem(401, 'Invalid signature')
    const p = parse(raw),
      m = p?.message
    if (
      p?.test ||
      !['message.received', 'poll.voted'].includes(p?.event) ||
      m?.direction !== 'in' ||
      m.status !== 'received' ||
      (m.service && m.service !== 'iMessage') ||
      !/^iMessage;\+;\S{1,110}$/.test(m.chat_id)
    )
      return json({ ignored: true })
    const chat = m.chat_id,
      line = m.line_id ?? 'single',
      h = normalizeHandle(m.handle),
      id = providerMessageId(m.id)
    if (!groupAllowed(chat) || !h || !id) throw problem(403, 'Group or participant unavailable')
    if (typeof m.text === 'string' && m.text.includes(origin + '/join/'))
      return json({ ignored: 'invitation' })
    const handles = await group(chat, line)
    let t = query('SELECT id,chat,line,title FROM wander_trip WHERE scope=$1 AND chat=$2 AND line=$3', [
      scope,
      chat,
      line,
    ])[0]
    if (!handles.includes(h)) {
      if (t) transaction(() => rosterWrite(t, handles))
      throw problem(403, 'Participant unavailable')
    }
    const cmd =
      p.event === 'message.received' && (!m.kind || m.kind === 'message')
        ? wandaCommandText(m.text)?.trim()
        : ''
    const title = /^start a trip\s+([^\r\n]{1,80})$/i.exec(cmd)?.[1].trim(),
      board = /^board$/i.test(cmd)
    if (!t && !title) return json({ ignored: 'Start a trip first' })
    transaction(() => {
      if (!t)
        t = query(
          'INSERT INTO wander_trip(id,scope,line,chat,title) VALUES($1,$2,$3,$4,$5) ON CONFLICT(scope,line,chat) DO UPDATE SET chat=excluded.chat RETURNING id,chat,line,title',
          [randomUUID(), scope, line, chat, title],
        )[0]
      rosterWrite(t, handles)
      if (title || board)
        query("INSERT INTO wander_reply VALUES($1,$2,'pending') ON CONFLICT DO NOTHING", [t.id, id])
    })
    const e = engine(t)
    syncNames(t, e)
    if (title || board) {
      void groupReply(t, id).catch(() => {})
      return json({ ok: true })
    }
    const replay = Readable.from([raw])
    replay.method = 'POST'
    replay.headers = req.headers
    await e.ingress(replay, res)
  }
  const cookieValue = (name, value, age) =>
    name +
    '=' +
    value +
    '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' +
    age +
    (origin.startsWith('https:') ? '; Secure' : '')
  const lookup = (id) =>
    query('SELECT id,chat,line,title FROM wander_trip WHERE id=$1 AND scope=$2', [id, scope]).find((t) =>
      t.line === 'manual' || groupAllowed(t.chat),
    )
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const json = (data, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(data))
    }
    try {
      const pathname = new URL(req.url, origin).pathname
      if (pathname === '/health') {
        query('SELECT 1')
        return json({ ok: true })
      }
      if (pathname === '/webhooks/zerosettle' && req.method === 'POST')
        return await webhook(req, res, await bytes(req), json)
      if (pathname === '/api/manual-trip' && req.method === 'POST') {
        if (req.headers.origin !== origin || req.headers['content-type']?.split(';')[0] !== 'application/json')
          throw problem(403, 'Request unavailable')
        const body = parse(await bytes(req))
        const title = typeof body?.title === 'string' ? body.title.trim() : ''
        const name = typeof body?.name === 'string' ? body.name.trim() : ''
        if ([title, name].some((value) => !value || value.length > 60 || /[\x00-\x1f]/.test(value)))
          throw problem(400, 'Enter a trip name and your name (1–60 characters each).')
        const id = randomUUID(), picker = randomUUID()
        const session = transaction(() => {
          query("INSERT INTO wander_trip(id,scope,line,chat,title) VALUES($1,$2,'manual',$3,$4)", [id, scope, id, title])
          query('INSERT INTO wander_member(trip,handle,picker,name,claimed) VALUES($1,$2,$3,$4,true)', [
            id, 'manual-' + picker, picker, name,
          ])
          return claim.issueSession(id, picker)
        })
        res.setHeader('set-cookie', cookieValue(sessionName({ id }), session, 2592000))
        return json({ path: '/t/' + id }, 201)
      }
      const route = new RegExp(
        '^/api/trip/(' + uuid + ')/(invite|challenge|verify|name|canvas|edit|logout)$',
      ).exec(pathname)
      if (route) {
        const t = lookup(route[1]),
          action = route[2]
        if (!t || (t.line === 'manual' && ['invite', 'challenge', 'verify'].includes(action)))
          throw problem(404, 'Trip unavailable')
        if (
          req.method === 'POST' &&
          (req.headers.origin !== origin || req.headers['content-type']?.split(';')[0] !== 'application/json')
        )
          throw problem(403, 'Request unavailable')
        if (req.method !== (action === 'invite' || action === 'canvas' ? 'GET' : 'POST'))
          throw problem(405, 'Unsupported method')
        const body = req.method === 'POST' ? parse(await bytes(req)) : {}
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw problem(400, 'Invalid request')
        const sess = cookie(req, sessionName(t))
        if (
          ['invite', 'challenge', 'verify'].includes(action) &&
          req.headers['x-wander-invite'] !== claim.invitation(t.id)
        )
          throw problem(403, 'Open the group invitation.')
        if (
          !['invite', 'challenge', 'verify', 'logout'].includes(action) &&
          !claim.session(cookie(req, sessionName(t)), t.id)
        )
          throw problem(401, 'Verify your number to open this trip.')
        if (action !== 'logout') await refresh(t)
        const me = claim.session(sess, t.id)
        let browser = cookie(req, 'wander_browser')
        if (action === 'invite') {
          if (!browser) {
            browser = token()
            res.setHeader('set-cookie', cookieValue('wander_browser', browser, 86400))
          }
          return json({
            title: t.title,
            verified: !!me,
            name: me?.name,
            members: members(t)
              .filter((m) => m.handle.startsWith('+'))
              .map((m) => ({
                id: m.picker,
                masked: mask(m.handle),
                claimed: m.claimed,
                name: m.claimed ? m.name : null,
              })),
          })
        }
        if (action === 'challenge' || action === 'verify') {
          if (!browser) throw problem(400, 'Open the invitation again.')
          if (action === 'challenge') return json(await claim.challenge(t, browser, body.picker))
          if (!/^\d{6}$/.test(body.code)) throw problem(400, 'Enter six digits.')
          const session = claim.verify(t, browser, body.challenge, body.code)
          res.setHeader('set-cookie', cookieValue(sessionName(t), session, 2592000))
          return json({ name: claim.session(session, t.id).name })
        }
        if (!me) throw problem(401, 'Verify your number to open this trip.')
        if (action === 'logout') {
          claim.logout(sess)
          res.setHeader('set-cookie', cookieValue(sessionName(t), '', 0))
          for (const c of channels.get(t.id) ?? []) if (c.cookie === sess) c.ws.close(1008)
          return json({ ok: true })
        }
        if (action === 'name') {
          const name = typeof body.name === 'string' ? body.name.trim() : ''
          if (!name || name.length > 60 || Array.from(name).some((c) => c.charCodeAt(0) < 32))
            throw problem(400, 'Enter a name of 1–60 characters.')
          query('UPDATE wander_member SET name=$1 WHERE picker=$2', [name, me.picker])
          syncNames(t, engine(t))
          return json({ ok: true })
        }
        if (!me.name) throw problem(403, 'Enter your name first.')
        const e = engine(t),
          doc = e.room.doc,
          identity = zeroSettleSenderId(me.handle)
        if (action === 'canvas')
          return json({ ...boardView(doc, identity), invite: t.line === 'manual' ? undefined : invite(t), viewerName: me.name })
        doc.transact(() => editCanvas(doc, identity, me.name, body), 'verified-browser')
        if (!e.flush()) throw problem(503, 'Could not save edit')
        return json({ ok: true })
      }
      const canvas = new RegExp('^/t/(' + uuid + ')/?$').exec(pathname)
      if (canvas) {
        const t = lookup(canvas[1])
        if (!t || !claim.session(cookie(req, sessionName(t)), t.id)?.name)
          throw problem(401, 'Open your group invitation to verify this device.')
      }
      const asset = /^\/assets\/[\w.-]+$/.test(pathname)
      if (
        req.method !== 'GET' ||
        (!asset && !canvas && !new RegExp('^/join/' + uuid + '/?$').test(pathname) && pathname !== '/')
      )
        throw problem(404, 'Unavailable')
      const file = asset ? path.join('dist', pathname) : 'dist/index.html'
      if (!fs.existsSync(file)) throw problem(404, 'Build unavailable')
      const types = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.png': 'image/png',
      }
      res.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream')
      if (!asset)
        return res.end(
          fs.readFileSync(file, 'utf8').replace('<head>', '<head><meta name="wander-hosted" content="1">'),
        )
      fs.createReadStream(file).pipe(res)
    } catch (err) {
      if (!res.headersSent)
        json({ error: err.status ? err.message : 'Service unavailable' }, err.status ?? 503)
      else res.end()
    }
  })
  // Recheck membership for idle viewers too. Each edit, entry, and webhook independently checks it.
  let checking = false
  const monitor = setInterval(async () => {
    if (checking) return
    checking = true
    try {
      for (const clients of channels.values()) {
        const first = clients.values().next().value
        if (!first) continue
        try {
          await refresh(first.t)
          for (const c of clients) if (!claim.session(c.cookie, c.t.id)) c.ws.close(1008)
        } catch {
          for (const c of clients) c.ws.close(1013)
        }
      }
    } finally {
      checking = false
    }
  }, 60000)
  monitor.unref()
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 })
  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => {})
    try {
      const match = new RegExp('^/live/(' + uuid + ')$').exec(req.url)
      const t = match && lookup(match[1])
      if (!t || req.headers.origin !== origin) throw Error()
      const secret = cookie(req, sessionName(t))
      if (!claim.session(secret, t.id)?.name) throw Error()
      await refresh(t)
      if (!claim.session(secret, t.id)?.name) throw Error()
      sockets.handleUpgrade(req, socket, head, (ws) => {
        const c = { ws, t, cookie: secret }
        if (!channels.has(t.id)) channels.set(t.id, new Set())
        channels.get(t.id).add(c)
        ws.on('message', () => ws.close(1008))
        ws.on('error', () => ws.terminate())
        ws.on('close', () => channels.get(t.id)?.delete(c))
        push(c)
      })
    } catch {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    }
  })
  async function resumeWork() {
    for (const t of query('SELECT id,chat,line,title FROM wander_trip WHERE scope=$1', [scope]).filter((t) =>
      groupAllowed(t.chat),
    )) {
      try {
        await refresh(t)
      } catch {
        continue
      }
      if (!members(t).length) continue
      engine(t)
      for (const r of query("SELECT message FROM wander_reply WHERE trip=$1 AND state='pending'", [t.id]))
        void groupReply(t, r.message).catch(() => {})
    }
  }
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(Number(env.PORT ?? 1234), opts.host ?? '0.0.0.0', resolve),
  )
  // Cold starts accept HTTP immediately. Startup, subsequent ingress and verified visits all wake durable work.
  void resumeWork().catch(() => {})
  return {
    port: server.address().port,
    close: async () => {
      clearInterval(monitor)
      for (const c of sockets.clients) c.terminate()
      for (const e of engines.values()) e.close()
      await new Promise((r) => server.close(r))
      await db.close()
    },
  }
}
