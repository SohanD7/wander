import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { startServer } from './relay.mjs'
import { PILOT_TRIP_ID, seedPilotTrip } from './pilot-fixture.mjs'

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
  it('rejects malformed HTTP and WebSocket URLs without disrupting the server', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-bad-url-data-'))
    const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-bad-url-web-'))
    fs.writeFileSync(path.join(staticDir, 'index.html'), '<title>app</title>')
    const srv = await startServer({ port: 0, host: '127.0.0.1', dataDir, staticDir, quiet: true, handleSignals: false })
    try {
      const base = `http://127.0.0.1:${srv.port}`
      expect((await fetch(`${base}/%E0%A4%A`)).status).toBe(400)
      const code = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/sync/%E0%A4%A`)
        ws.once('close', resolve)
        ws.once('error', reject)
      })
      expect(code).toBe(1008)
      expect(srv.rooms.size).toBe(0)
      expect((await (await fetch(`${base}/health`)).json()).ok).toBe(true)
      const a = client(srv.port, 'valid-after-malformed')
      await a.synced
      expect(a.provider.synced).toBe(true)
    } finally {
      opened.splice(0).forEach((close) => close())
      await srv.close()
      fs.rmSync(dataDir, { recursive: true, force: true })
      fs.rmSync(staticDir, { recursive: true, force: true })
    }
  })

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


describe('local pilot message ingress', () => {
  it('requires explicit opt-in and refuses a public bind', async () => {
    expect(() => startServer({ host: '0.0.0.0', testMessages: true })).toThrow('requires HOST')
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-pilot-off-'))
    const srv = await startServer({ host: '127.0.0.1', port: 0, dataDir, quiet: true, handleSignals: false, testMessages: false })
    try {
      expect((await fetch(`http://127.0.0.1:${srv.port}/local/test-message`, { method: 'POST' })).status).toBe(404)
    } finally { await srv.close(); fs.rmSync(dataDir, { recursive: true, force: true }) }
  })

  it('broadcasts one vote, deduplicates concurrent replays and survives restart', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-pilot-test-'))
    const options = { host: '127.0.0.1', port: 0, dataDir, staticDir: '/nonexistent', quiet: true, handleSignals: false, testMessages: true }
    let srv = await startServer(options)
    const message = { messageId: 'msg-1', tripId: PILOT_TRIP_ID, senderId: 'chat-alice', text: 'I vote for Lisbon' }
    const post = (body = message, headers = {}) => fetch(`http://127.0.0.1:${srv.port}/local/test-message`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    })
    try {
      const board = client(srv.port, `wander-${PILOT_TRIP_ID}`)
      const other = client(srv.port, 'wander-other-trip')
      await Promise.all([board.synced, other.synced])
      seedPilotTrip(board.doc)
      await until(() => srv.rooms.get(`wander-${PILOT_TRIP_ID}`).doc.getMap('meta').get('seeded'))
      expect((await post(message, { origin: 'https://example.com' })).status).toBe(403)
      expect((await post({ ...message, tripId: 'missing-trip' })).status).toBe(404)
      expect((await post({ ...message, senderId: 'bad|sender' })).status).toBe(400)
      expect((await post({ ...message, text: 'I vote for Rome' })).status).toBe(422)
      const responses = await Promise.all(Array.from({ length: 5 }, () => post().then((r) => r.json())))
      expect(responses.filter((r) => !r.duplicate)).toHaveLength(1)
      expect(responses.every((r) => r.count === 1)).toBe(true)
      await until(() => board.doc.getMap('votes').size === 1)
      expect(board.doc.getMap('votes').toJSON()).toEqual({ 'w_destination|o_lisbon|chat-alice': expect.any(Number) })
      expect(other.doc.getMap('votes').size).toBe(0)
      expect((await post({ ...message, senderId: 'chat-bob' })).status).toBe(409)
      expect((await (await post({ ...message, messageId: 'msg-2' })).json()).count).toBe(1)
      opened.splice(0).forEach((close) => close())
      await srv.close()
      srv = await startServer(options)
      const rejoined = client(srv.port, `wander-${PILOT_TRIP_ID}`)
      await rejoined.synced
      expect(await (await post()).json()).toMatchObject({ duplicate: true, count: 1 })
      // A replay must not recreate a vote subsequently removed on the board.
      rejoined.doc.getMap('votes').delete('w_destination|o_lisbon|chat-alice')
      await until(() => srv.rooms.get(`wander-${PILOT_TRIP_ID}`).doc.getMap('votes').size === 0)
      expect(await (await post()).json()).toMatchObject({ duplicate: true, count: 0 })
      const poll = rejoined.doc.getMap('widgets').get('w_destination')
      rejoined.doc.getMap('widgets').set(poll.id, { ...poll, options: [{ id: 'o_porto', text: 'Porto' }] })
      await until(() => srv.rooms.get(`wander-${PILOT_TRIP_ID}`).doc.getMap('widgets').get(poll.id).options.length === 1)
      expect((await post({ ...message, messageId: 'msg-3' })).status).toBe(422)
      expect(rejoined.doc.getMap('votes').size).toBe(0)
    } finally {
      opened.splice(0).forEach((close) => close())
      await srv.close()
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })
})

describe('Twilio Conversations adapter', () => {
  it('authenticates every field before mutations, maps identities, ignores noise, and replays across restart', async () => {
    const { sampleConfig, sampleEvent, signSample } = await import('./twilio-sample.mjs')
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-twilio-test-'))
    const config = sampleConfig(1241)
    // Exercise exact public URL validation behind a local relay, including a query string.
    config.webhookUrl = 'https://wander.example/webhooks/twilio/conversations?pilot=1'
    config.replies = 'live'
    config.ownParticipantSid = 'MB' + '9'.repeat(32)
    const replies = []
    const options = { host: '127.0.0.1', port: 0, dataDir, quiet: true, handleSignals: false, twilio: config,
      sendTwilioReply: async (...args) => replies.push(args) }
    let srv = await startServer(options)
    const post = (event, signature = signSample(config, event), target = '/webhooks/twilio/conversations?pilot=1') => fetch(`http://127.0.0.1:${srv.port}${target}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature,
        host: 'spoofed.example', 'x-forwarded-proto': 'http' }, body: new URLSearchParams(event),
    })
    try {
      const alice = sampleEvent('alice')
      const bob = sampleEvent('bob')
      expect((await post(alice, 'invalid')).status).toBe(403)
      expect(srv.rooms.size).toBe(0)
      const board = client(srv.port, `wander-${PILOT_TRIP_ID}`)
      await board.synced
      seedPilotTrip(board.doc)
      await until(() => srv.rooms.get(`wander-${PILOT_TRIP_ID}`).doc.getMap('meta').get('seeded'))
      const serverDoc = srv.rooms.get(`wander-${PILOT_TRIP_ID}`).doc
      const unchanged = Y.encodeStateAsUpdate(serverDoc)
      expect((await post({ ...alice, Body: 'board' }, signSample(config, alice))).status).toBe(403)
      expect((await post(alice, signSample(sampleConfig(1241), alice))).status).toBe(403)
      expect((await post(alice, signSample(config, alice), '/webhooks/twilio/conversations')).status).toBe(403)
      expect(Y.encodeStateAsUpdate(serverDoc)).toEqual(unchanged)
      for (const event of [
        { ...alice, EventType: 'onMessageUpdated' },
        { ...alice, ConversationSid: 'CH' + '8'.repeat(32) },
        { ...alice, Author: 'wander' },
        { ...alice, ParticipantSid: config.ownParticipantSid },
        { ...alice, ParticipantSid: '' },
        { ...alice, Body: 'hello crew' },
      ]) expect((await (await post(event)).json()).ignored).toBeTruthy()
      expect(Y.encodeStateAsUpdate(serverDoc)).toEqual(unchanged)
      expect((await (await post(alice)).json()).count).toBe(1)
      expect((await (await post(bob)).json()).count).toBe(2)
      await until(() => board.doc.getMap('votes').size === 2)
      expect([...board.doc.getMap('votes').keys()].sort()).toEqual([
        `w_destination|o_lisbon|${alice.ParticipantSid}`, `w_destination|o_lisbon|${bob.ParticipantSid}`,
      ])
      for (const event of [alice, bob, alice, bob]) expect(await (await post(event)).json()).toMatchObject({ duplicate: true, count: 2 })
      expect((await post({ ...alice, ParticipantSid: bob.ParticipantSid })).status).toBe(409)
      expect(replies).toHaveLength(0)
      const boardCommand = sampleEvent('board', 'board')
      expect((await (await post(boardCommand)).json()).reply.sent).toBe(true)
      expect(replies).toEqual([[alice.ConversationSid, 'http://127.0.0.1:1241/t/pilot-lisbon-demo']])
      expect((await (await post(boardCommand)).json()).duplicate).toBe(true)
      opened.splice(0).forEach((close) => close())
      await srv.close()
      srv = await startServer(options)
      for (const event of [alice, bob]) expect(await (await post(event)).json()).toMatchObject({ duplicate: true, count: 2 })
      expect((await (await post(boardCommand)).json()).duplicate).toBe(true)
      expect(replies).toHaveLength(1)
      const reopened = client(srv.port, `wander-${PILOT_TRIP_ID}`)
      await reopened.synced
      expect(reopened.doc.getMap('votes').size).toBe(2)
      const beforeBad = Y.encodeStateAsUpdate(srv.rooms.get(`wander-${PILOT_TRIP_ID}`).doc)
      expect((await post(sampleEvent('invalid'), 'invalid')).status).toBe(403)
      expect(Y.encodeStateAsUpdate(srv.rooms.get(`wander-${PILOT_TRIP_ID}`).doc)).toEqual(beforeBad)
    } finally {
      opened.splice(0).forEach((close) => close())
      await srv.close()
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })
})

describe('Twilio Programmable Messaging SMS', () => {
  const sms = {
    authToken: 'wander-sms-sample-token', webhookUrl: 'https://sms.example/webhooks/twilio/sms?pilot=1',
    tripId: PILOT_TRIP_ID, to: '+12025550100', testers: ['+12025550101'],
  }
  const message = { From: '+12025550101', To: sms.to, Body: 'I vote for Lisbon', MessageSid: 'SM' + 'a'.repeat(32), NumMedia: '0' }
  async function fixture(run) {
    const { default: twilio } = await import('twilio')
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-sms-test-'))
    const options = { host: '127.0.0.1', port: 0, dataDir, quiet: true, handleSignals: false, sms }
    let srv = await startServer(options)
    const post = (event = message, signature = twilio.getExpectedTwilioSignature(sms.authToken, sms.webhookUrl, event)) => fetch(`http://127.0.0.1:${srv.port}/webhooks/twilio/sms?pilot=1`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature,
        'x-forwarded-host': 'untrusted.example' }, body: new URLSearchParams(event),
    })
    try {
      const board = client(srv.port, `wander-${PILOT_TRIP_ID}`)
      await board.synced
      seedPilotTrip(board.doc)
      await until(() => srv.rooms.get(`wander-${PILOT_TRIP_ID}`).doc.getMap('meta').get('seeded'))
      await run({ board, post, doc: () => srv.rooms.get(`wander-${PILOT_TRIP_ID}`).doc,
        restart: async () => {
          opened.splice(0).forEach((close) => close())
          await srv.close()
          srv = await startServer(options)
        } })
    } finally {
      opened.splice(0).forEach((close) => close())
      await srv.close()
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  }
  it('processes a signed vote with From as identity and returns empty TwiML', async () => {
    await fixture(async ({ board, post, doc }) => {
      const response = await post()
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/xml')
      expect(await response.text()).toBe('<Response/>')
      await until(() => board.doc.getMap('votes').size === 1)
      expect(board.doc.getMap('votes').has(`w_destination|o_lisbon|${message.From}`)).toBe(true)
      expect(doc().getMap('pilotMessageReceipts').has(message.MessageSid)).toBe(true)
    })
  })
  it('returns empty TwiML for duplicate delivery, including after restart', async () => {
    await fixture(async ({ post, doc, restart }) => {
      expect(await (await post()).text()).toBe('<Response/>')
      const originalVote = doc().getMap('votes').get(`w_destination|o_lisbon|${message.From}`)
      for (let i = 0; i < 2; i++) {
        const replay = await post()
        expect(replay.status).toBe(200)
        expect(await replay.text()).toBe('<Response/>')
        expect(doc().getMap('votes').size).toBe(1)
      }
      await restart()
      const replay = await post()
      expect(replay.status).toBe(200)
      expect(await replay.text()).toBe('<Response/>')
      expect(doc().getMap('votes').toJSON()).toEqual({ [`w_destination|o_lisbon|${message.From}`]: originalVote })
    })
  })
  it('rejects invalid signatures, altered payloads and non-allowlisted phones without changing the document', async () => {
    await fixture(async ({ post, doc }) => {
      const before = Y.encodeStateAsUpdate(doc())
      expect((await post(message, 'invalid')).status).toBe(403)
      const { default: twilio } = await import('twilio')
      const signature = twilio.getExpectedTwilioSignature(sms.authToken, sms.webhookUrl, message)
      expect((await post({ ...message, Body: 'board' }, signature)).status).toBe(403)
      expect((await post({ ...message, From: '+12025550199' })).status).toBe(403)
      expect((await post({ ...message, To: '+12025550199' })).status).toBe(403)
      expect((await post({ ...message, Body: 'board' })).status).toBe(422)
      expect(Y.encodeStateAsUpdate(doc())).toEqual(before)
    })
  })
})
