import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { startServer } from './relay.mjs'
import { seedPilotTrip, PILOT_TRIP_ID } from './pilot-fixture.mjs'
import { createZeroSettleAdapter, verifyZeroSettleSignature, testerNames } from './zerosettle.mjs'
import { loadZeroSettleEnv } from './zerosettle-env.mjs'

const secret = 'whsec_sample_only_not_a_real_credential'
const config = { webhookSecret: secret, chatId: 'iMessage;+;chatWanderPilot', testers: ['+12025550101', 'bob@example.com'], tripId: PILOT_TRIP_ID }
const event = (id = 71, handle = config.testers[0]) => ({ event: 'message.received', message: {
  id, kind: 'message', direction: 'in', status: 'received', handle, text: 'I vote for Lisbon', chat_id: config.chatId,
} })
const sign = (raw, timestamp = Math.floor(Date.now() / 1000), key = secret) => `t=${timestamp},v1=${crypto.createHmac('sha256', key).update(`${timestamp}.`).update(raw).digest('hex')}`
const until = async (fn) => {
  const deadline = Date.now() + 4000
  while (!fn()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for Yjs sync')
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
}
async function fixture(run, { acknowledgments = false, send, fetchImpl, names } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-zerosettle-'))
  const options = { host: '127.0.0.1', port: 0, dataDir, staticDir: '/nonexistent', quiet: true, handleSignals: false, zerosettle: { ...config, testerNames: names, acknowledgments, apiKey: 'sample-key-not-real' }, sendZeroSettleAcknowledgment: send, zeroSettleFetch: fetchImpl }
  let server = await startServer(options)
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(`ws://127.0.0.1:${server.port}/sync`, `wander-${PILOT_TRIP_ID}`, doc, { WebSocketPolyfill: WebSocket, disableBc: true })
  const post = async (payload, header, raw = JSON.stringify(payload)) => fetch(`http://127.0.0.1:${server.port}/webhooks/zerosettle`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-zerosettle-signature': header ?? sign(raw) }, body: raw,
  })
  const serverDoc = () => server.rooms.get(`wander-${PILOT_TRIP_ID}`).doc
  try {
    await new Promise((resolve) => provider.once('synced', resolve))
    seedPilotTrip(doc)
    await until(() => serverDoc().getMap('meta').get('seeded'))
    await run({ post, doc, provider, serverDoc, restart: async () => {
      provider.disconnect()
      await server.close()
      server = await startServer(options)
      // Replay before reconnecting any client: receipts must come from disk alone.
    } })
  } finally {
    provider.destroy()
    doc.destroy()
    await server.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

describe('ZeroSettle group pilot', () => {
  it('counts two signed group testers live, and persists message receipts across restart', async () => {
    await fixture(async ({ post, doc, restart, serverDoc }) => {
      const first = event()
      const second = event(72, config.testers[1])
      // Raw-byte signatures remain valid with noncanonical JSON spacing/key order.
      const raw = JSON.stringify(first, null, 2) + '\n'
      expect(await (await post(first, sign(raw), raw)).json()).toMatchObject({ duplicate: false, count: 1 })
      await until(() => doc.getMap('votes').size === 1)
      expect(await (await post(second)).json()).toMatchObject({ duplicate: false, count: 2 })
      await until(() => doc.getMap('votes').size === 2)
      expect([...doc.getMap('votes').keys()]).toContain('w_destination|o_lisbon|zs-' + crypto.createHash('sha256').update(config.testers[1]).digest('hex'))
      const state = Y.encodeStateAsUpdate(serverDoc())
      const replays = await Promise.all([post(first), post(second), post(first)])
      for (const response of replays) expect(await response.json()).toMatchObject({ duplicate: true, count: 2 })
      expect(Y.encodeStateAsUpdate(serverDoc())).toEqual(state)
      // A different message from the same email (different case) is still one voter.
      expect(await (await post(event(73, 'BOB@EXAMPLE.COM'))).json()).toMatchObject({ count: 2 })
      await restart()
      for (const payload of [first, second]) expect(await (await post(payload)).json()).toMatchObject({ duplicate: true, count: 2 })
      expect(serverDoc().getMap('pilotMessageReceipts').has('zerosettle.message.received.71')).toBe(true)
      expect(serverDoc().getMap('votes').size).toBe(2)
    })
  })
  it('accepts Porto in any casing, preserves Lisbon and deduplicates each option after restart', async () => {
    await fixture(async ({ post, doc, serverDoc, restart }) => {
      const lisbon = event()
      const porto = event(72, config.testers[1])
      porto.message.text = '  i vote for porto  '
      expect(await (await post(lisbon)).json()).toMatchObject({ count: 1 })
      expect(await (await post(porto)).json()).toMatchObject({ duplicate: false, count: 1 })
      await until(() => doc.getMap('votes').size === 2)
      const portoKey = 'w_destination|o_porto|zs-' + crypto.createHash('sha256').update(config.testers[1]).digest('hex')
      expect(doc.getMap('votes').has(portoKey)).toBe(true)
      expect([...doc.getMap('votes').keys()].filter((key) => key.startsWith('w_destination|o_lisbon|'))).toHaveLength(1)
      expect(await (await post(porto)).json()).toMatchObject({ duplicate: true, count: 1 })
      for (const [i, text] of ['I vote for Porto', 'I VOTE FOR PORTO', 'i VoTe FoR pOrTo'].entries()) {
        const variant = event(74 + i, config.testers[1])
        variant.message.text = text
        expect(await (await post(variant)).json()).toMatchObject({ count: 1 })
        expect(serverDoc().getMap('votes').size).toBe(2)
      }
      const unknown = event(73, config.testers[1])
      unknown.message.text = 'I vote for Rome'
      const before = Y.encodeStateAsUpdate(serverDoc())
      expect((await post(unknown)).status).toBe(422)
      expect(Y.encodeStateAsUpdate(serverDoc())).toEqual(before)
      await restart()
      for (const payload of [lisbon, porto]) expect(await (await post(payload)).json()).toMatchObject({ duplicate: true, count: 1 })
      expect(serverDoc().getMap('votes').size).toBe(2)
    })
  })
  it('rejects invalid, stale, future, malformed and body-altered signatures before touching the document', async () => {
    await fixture(async ({ post, serverDoc }) => {
      const before = Y.encodeStateAsUpdate(serverDoc())
      const payload = event()
      const raw = JSON.stringify(payload)
      for (const header of ['', 'invalid', sign(raw, Math.floor(Date.now() / 1000) - 301),
        sign(raw, Math.floor(Date.now() / 1000) + 302), sign(raw, undefined, 'wrong-secret'),
        't=0,v1=' + 'a'.repeat(64)]) {
        expect((await post(payload, header)).status).toBe(401)
      }
      expect((await post(payload, sign(raw), raw + ' ')).status).toBe(401)
      expect((await post(null, sign('not json'), 'not json')).status).toBe(400)
      expect(Y.encodeStateAsUpdate(serverDoc())).toEqual(before)
    })
  })
  it('rejects other groups, direct messages and unknown testers; ignores outbound and nontext events', async () => {
    await fixture(async ({ post, serverDoc }) => {
      const before = Y.encodeStateAsUpdate(serverDoc())
      for (const message of [
        { ...event().message, chat_id: 'iMessage;+;chatOtherGroup' },
        { ...event().message, chat_id: undefined },
        { ...event().message, handle: '+12025550199' },
      ]) expect((await post({ event: 'message.received', message })).status).toBe(403)
      for (const payload of [
        { ...event(), event: 'message.sent' }, { ...event(), event: 'message.failed' },
        { ...event(), event: 'reaction.received' }, { event: 'typing.started' },
        { ...event(), message: { ...event().message, direction: 'out' } },
        { ...event(), message: { ...event().message, kind: 'image' } },
        { ...event(), message: { ...event().message, service: 'SMS' } },
        { ...event(), message: { ...event().message, text: 'board' } },
        { ...event(), test: true },
      ]) expect((await (await post(payload)).json()).ignored).toBeTruthy()
      expect((await post(event(0))).status).toBe(400)
      expect((await post(event(Number.MAX_SAFE_INTEGER + 1))).status).toBe(400)
      expect(Y.encodeStateAsUpdate(serverDoc())).toEqual(before)
    })
  })
  it('creates live attributed note cards for unique URLs without fetching pages, and never recreates them on replay', async () => {
    let sends = 0
    await fixture(async ({ post, doc, serverDoc, restart }) => {
      const payload = event(81)
      payload.message.text = 'Nice place https://example.com/stay?x=1&y=2 and (https://example.org/food). https://example.com/stay?x=1&y=2'
      const response = await (await post(payload)).json()
      expect(response.cardIds).toHaveLength(2)
      await until(() => doc.getMap('widgets').size === 3)
      const cards = response.cardIds.map((id) => doc.getMap('widgets').get(id))
      expect(cards.every((c) => c.type === 'note' && c.author === config.testers[0])).toBe(true)
      expect(cards.map((c) => c.source.url)).toEqual(['https://example.com/stay?x=1&y=2', 'https://example.org/food'])
      expect(cards.every((c) => c.text.includes('Nice place') && c.source.messageText === payload.message.text)).toBe(true)
      expect(serverDoc().getMap('pilotAcknowledgments').get(response.messageId).state).toBe('disabled')
      expect((await (await post(payload)).json()).duplicate).toBe(true)
      await restart()
      expect((await (await post(payload)).json()).duplicate).toBe(true)
      expect(serverDoc().getMap('widgets').size).toBe(3)
      expect(sends).toBe(0)
      serverDoc().getMap('widgets').delete(response.cardIds[0])
      await post(payload)
      expect(serverDoc().getMap('widgets').has(response.cardIds[0])).toBe(false)
    }, { send: async () => { sends++; return { state: 'sent' } } })
  })
  it('saves a mixed vote/link message atomically and sends just one group acknowledgment despite concurrent replays and restart', async () => {
    const calls = []
    let release
    const completion = new Promise((resolve) => { release = resolve })
    await fixture(async ({ post, doc, serverDoc, restart }) => {
      const payload = event(82)
      payload.message.text = 'i VoTe FoR pOrTo https://example.com/hotel\nThis looks good'
      const response = await (await post(payload)).json()
      expect(response).toMatchObject({ count: 1 })
      expect(response.cardIds).toHaveLength(1)
      await until(() => doc.getMap('votes').size === 1 && doc.getMap('widgets').size === 2)
      await until(() => calls.length === 1)
      expect(serverDoc().getMap('pilotAcknowledgments').get(response.messageId).state).toBe('sending')
      for (const result of await Promise.all([post(payload), post(payload), post(payload)])) expect((await result.json()).duplicate).toBe(true)
      expect(calls).toEqual([[config.chatId, 'Saved to your trip board.']])
      release({ state: 'sent', providerMessageId: 900 })
      await until(() => serverDoc().getMap('pilotAcknowledgments').get(response.messageId).state === 'sent')
      await restart()
      expect((await (await post(payload)).json()).duplicate).toBe(true)
      expect(calls).toHaveLength(1)
      expect(serverDoc().getMap('widgets').size).toBe(2)
      expect(serverDoc().getMap('votes').size).toBe(1)
    }, { acknowledgments: true, send: async (...args) => { calls.push(args); return completion } })
  })
  it.each([
    ['network timeout', 'uncertain', () => { throw new Error('sample transport failure') }],
    ['upstream 503', 'uncertain', () => new Response('{}', { status: 503 })],
    ['opt-out 403', 'failed', () => new Response('{}', { status: 403 })],
    ['accepted', 'sent', () => Response.json({ ok: true, status: 'message_sent', id: 901 })],
  ])('preserves cards and never repeats an acknowledgment after %s, including restart', async (_name, state, reply) => {
    const requests = []
    await fixture(async ({ post, serverDoc, restart }) => {
      const payload = event(83)
      payload.message.text = 'Try this http://example.com/place'
      const result = await (await post(payload)).json()
      await until(() => serverDoc().getMap('pilotAcknowledgments').get(result.messageId).state === state)
      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe('https://portal.zerosettle.io/api/imessage/send')
      expect(JSON.parse(requests[0].init.body)).toEqual({ chat_id: config.chatId, text: 'Saved to your trip board.' })
      expect(requests[0].init.headers.Authorization).toBe('Bearer sample-key-not-real')
      await post(payload)
      await restart()
      await post(payload)
      expect(requests).toHaveLength(1)
      expect(serverDoc().getMap('widgets').size).toBe(2)
      expect(serverDoc().getMap('pilotAcknowledgments').get(result.messageId).state).toBe(state)
    }, { acknowledgments: true, fetchImpl: async (url, init) => { requests.push({ url, init }); return reply() } })
  })
  it('sends no acknowledgment until its claim is saved, then safely resumes on a replay', async () => {
    let calls = 0
    await fixture(async ({ post, serverDoc }) => {
      const payload = event(87)
      payload.message.text = 'A place https://example.com/claim-test'
      const rename = fs.renameSync
      let writes = 0
      const spy = vi.spyOn(fs, 'renameSync').mockImplementation((...args) => {
        if (++writes === 2) throw new Error('sample claim persistence failure')
        return rename(...args)
      })
      const logging = vi.spyOn(console, 'error').mockImplementation(() => {})
      let response
      try { response = await (await post(payload)).json() } finally { spy.mockRestore(); logging.mockRestore() }
      expect(response.cardIds).toHaveLength(1)
      expect(calls).toBe(0)
      expect(serverDoc().getMap('pilotAcknowledgments').get(response.messageId).state).toBe('pending')
      expect((await (await post(payload)).json()).duplicate).toBe(true)
      await until(() => serverDoc().getMap('pilotAcknowledgments').get(response.messageId).state === 'sent')
      expect(calls).toBe(1)
    }, { acknowledgments: true, send: async () => { calls++; return { state: 'sent', providerMessageId: 903 } } })
  })
  it('creates separate cards for several links but sends one acknowledgment per source message', async () => {
    let calls = 0
    await fixture(async ({ post, serverDoc }) => {
      const payload = event(88)
      payload.message.text = 'Ideas https://example.com/a and https://example.com/b'
      const result = await (await post(payload)).json()
      expect(result.cardIds).toHaveLength(2)
      await until(() => serverDoc().getMap('pilotAcknowledgments').get(result.messageId).state === 'sent')
      expect(calls).toBe(1)
      await post(payload)
      expect(calls).toBe(1)
    }, { acknowledgments: true, send: async () => { calls++; return { state: 'sent', providerMessageId: 904 } } })
  })
  it('recovers a queued acknowledgment on restart but never repeats an in-flight send claim', async () => {
    let calls = 0
    await fixture(async ({ post, serverDoc, restart }) => {
      const first = event(84)
      first.message.text = 'First https://example.com/one'
      const second = event(85)
      second.message.text = 'Second https://example.com/two'
      const a = await (await post(first)).json()
      await until(() => calls === 1)
      const b = await (await post(second)).json()
      expect(serverDoc().getMap('pilotAcknowledgments').get(b.messageId).state).toBe('pending')
      await restart()
      await until(() => calls === 2)
      await until(() => serverDoc().getMap('pilotAcknowledgments').get(b.messageId).state === 'sent')
      expect(serverDoc().getMap('pilotAcknowledgments').get(a.messageId).state).toBe('uncertain')
      await post(first)
      await post(second)
      expect(calls).toBe(2)
      expect(serverDoc().getMap('widgets').size).toBe(3)
    }, { acknowledgments: true, send: async () => { calls++; return calls === 1 ? new Promise(() => {}) : { state: 'sent', providerMessageId: 902 } } })
  })
  it('creates no cards or acknowledgments for unauthorized, invalidly signed or outbound link events', async () => {
    let calls = 0
    await fixture(async ({ post, serverDoc }) => {
      const payload = event(86)
      payload.message.text = 'Check https://example.com/private'
      payload.message.ts_ms = Date.now()
      const before = Y.encodeStateAsUpdate(serverDoc())
      expect((await post(payload, 'invalid')).status).toBe(401)
      expect((await post({ ...payload, message: { ...payload.message, chat_id: 'iMessage;+;chatOther' } })).status).toBe(403)
      expect((await post({ ...payload, message: { ...payload.message, handle: '+12025550999' } })).status).toBe(403)
      for (const type of ['message.sent', 'message.failed']) expect((await (await post({ ...payload, event: type })).json()).ignored).toBe('event type')
      expect(Y.encodeStateAsUpdate(serverDoc())).toEqual(before)
      expect(calls).toBe(0)
    }, { acknowledgments: true, send: async () => { calls++; return { state: 'sent' } } })
  })

  it('uses private configured names for stable members and new cards; keeps legacy attribution resolvable', async () => {
    await fixture(async ({ post, doc, serverDoc, restart }) => {
      const senderId = 'zs-' + crypto.createHash('sha256').update(config.testers[0]).digest('hex')
      const legacy = { id: 'legacy', type: 'note', x: 180, y: 900, z: 3, text: 'https://example.com/old', author: config.testers[0], source: { senderId } }
      serverDoc().getMap('widgets').set('legacy', legacy)
      const payload = event(100)
      payload.message.text = 'A good place https://example.com/new'
      const response = await (await post(payload)).json()
      await until(() => doc.getMap('widgets').has(response.cardIds[0]))
      expect(doc.getMap('widgets').get(response.cardIds[0]).author).toBe('Alice')
      expect(doc.getMap('members').get(senderId).name).toBe('Alice')
      expect(serverDoc().getMap('widgets').get('legacy')).toEqual(legacy)
      await post(event(101))
      expect([...serverDoc().getMap('votes').keys()][0]).toContain(senderId)
      await restart()
      await post(payload)
      expect(serverDoc().getMap('members').get(senderId).name).toBe('Alice')
      expect(serverDoc().getMap('widgets').get('legacy')).toEqual(legacy)
    }, { names: { [config.testers[0]]: 'Alice' } })
  })
  it.each([false, true])('durably correlates split comments in either delivery order (link first: %s)', async (linkFirst) => {
    let sends = 0
    await fixture(async ({ post, doc, serverDoc, restart }) => {
      const comment = event(200)
      comment.message.text = 'i vote for Porto\nNice place near the river'
      comment.message.ts_ms = Date.now()
      const link = event(201)
      link.message.text = 'github.com/username'
      link.message.ts_ms = comment.message.ts_ms + 5400
      const first = linkFirst ? link : comment
      const second = linkFirst ? comment : link
      expect((await post(first)).status).toBe(200)
      if (linkFirst) await until(() => sends === 1)
      if (linkFirst) await until(() => doc.getMap('widgets').size === 2)
      await restart()
      expect((await post(second)).status).toBe(200)
      await until(() => sends === 1)
      const cards = [...serverDoc().getMap('widgets').values()].filter((w) => w.type === 'note')
      expect(cards).toHaveLength(1)
      expect(cards[0].text).toContain('Nice place near the river')
      expect(cards[0].source.commentMessageId).toBe('zerosettle.message.received.200')
      expect(cards[0].source.url).toBe('https://github.com/username')
      expect(serverDoc().getMap('votes').size).toBe(1)
      expect(serverDoc().getMap('pilotLinkFragments').size).toBe(0)
      await restart()
      for (const payload of [comment, link, comment]) expect((await (await post(payload)).json()).duplicate).toBe(true)
      expect(sends).toBe(1)
      expect(serverDoc().getMap('widgets').size).toBe(2)
    }, { acknowledgments: true, send: async () => { sends++; return { state: 'sent', providerMessageId: 999 } } })
  })
  it('never consumes a comment twice or merges other senders, nonadjacent IDs, late links or a link with its own comment', async () => {
    await fixture(async ({ post, serverDoc }) => {
      const timestamp = Date.now()
      const make = (id, text, ts = timestamp, handle = config.testers[0]) => ({ ...event(id, handle), message: { ...event(id, handle).message, text, ts_ms: ts } })
      await post(make(300, 'This is a lovely place'))
      await post(make(301, 'https://example.com/a', timestamp + 5000, config.testers[1]))
      await post(make(302, 'https://example.com/b', timestamp + 5000))
      await post(make(310, 'Another lovely place here'))
      await post(make(311, 'https://example.com/c', timestamp + 6001))
      await post(make(320, 'Comment should stay unused'))
      await post(make(321, 'Own comment https://example.com/d', timestamp + 5000))
      const cards = [...serverDoc().getMap('widgets').values()].filter((w) => w.type === 'note')
      expect(cards.slice(0, 3).every((w) => w.text === w.source.url)).toBe(true)
      expect(cards[3].text).toContain('Own comment')
      expect(cards[3].text).not.toContain('unused')
      await post(make(330, 'Use this comment only once'))
      await post(make(331, 'https://example.com/e', timestamp + 5000))
      await post(make(332, 'https://example.com/f', timestamp + 5500))
      const notes = [...serverDoc().getMap('widgets').values()].filter((w) => w.type === 'note')
      expect(notes.filter((w) => w.text.includes('only once'))).toHaveLength(1)
    })
  })
  it('preserves edits and deletions when the split comment arrives late, and expires/bounds pending fragments', async () => {
    await fixture(async ({ post, serverDoc }) => {
      const timestamp = Date.now()
      const make = (id, text, ts = timestamp) => ({ ...event(id), message: { ...event(id).message, text, ts_ms: ts } })
      const saved = await (await post(make(401, 'https://example.com/edit https://example.com/delete', timestamp + 5200))).json()
      const widgets = serverDoc().getMap('widgets')
      widgets.set(saved.cardIds[0], { ...widgets.get(saved.cardIds[0]), text: 'User edit', x: 1200, y: 1800 })
      widgets.delete(saved.cardIds[1])
      await post(make(400, 'Original accompanying comment'))
      expect(widgets.get(saved.cardIds[0])).toMatchObject({ text: 'User edit', x: 1200, y: 1800 })
      expect(widgets.has(saved.cardIds[1])).toBe(false)
      await post(make(410, 'Expired comment must not attach'))
      const fragments = serverDoc().getMap('pilotLinkFragments')
      const key = 'zerosettle.message.received.410'
      fragments.set(key, { ...fragments.get(key), arrivedAt: Date.now() - 61000 })
      const late = await (await post(make(411, 'https://example.com/late', timestamp + 5000))).json()
      expect(widgets.get(late.cardIds[0]).text).toBe('https://example.com/late')
      for (let id = 500; id < 635; id++) await post(make(id, 'Some ordinary pending prose'))
      expect(fragments.size).toBeLessThanOrEqual(128)
    })
  })
  it('packs concurrent incoming cards into free columns without moving or overlapping existing content', async () => {
    await fixture(async ({ post, doc, serverDoc }) => {
      const widgets = serverDoc().getMap('widgets')
      widgets.set('moved', { id: 'moved', type: 'note', x: 576, y: 132, w: 360, h: 480, z: 2, text: 'User moved', author: 'User' })
      const before = widgets.get('moved')
      const replies = await Promise.all(Array.from({ length: 6 }, (_, i) => {
        const payload = event(700 + i); payload.message.text = `https://example.com/${i}`; return post(payload)
      }))
      const ids = (await Promise.all(replies.map((r) => r.json()))).flatMap((r) => r.cardIds)
      await until(() => ids.every((id) => doc.getMap('widgets').has(id)))
      expect(widgets.get('moved')).toEqual(before)
      const cards = ids.map((id) => widgets.get(id))
      expect(new Set(cards.map((w) => `${w.x}|${w.y}`)).size).toBe(6)
      expect(Math.max(...cards.map((w) => w.y))).toBeLessThan(1200)
      const { footprint } = await import('../src/collab/placement.mjs')
      const boxes = [...widgets.values()].map(footprint)
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]]
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
      }
    })
  })

  it('fails closed for incomplete configuration and checks the documented timestamp tolerance', () => {
    for (const patch of [{ webhookSecret: '' }, { testers: [] }, { chatId: '+12025550101' }, { tripId: '' }]) {
      expect(() => createZeroSettleAdapter({ config: { ...config, ...patch }, executePilotMessage() {} })).toThrow('ZeroSettle requires')
    }
    expect(testerNames({ 'BOB@EXAMPLE.COM': ' Bob ' })).toEqual({ 'bob@example.com': 'Bob' })
    for (const value of ['not JSON', [], { 'not a handle': 'Name' }, { '+12025550101': '' }, { '+12025550101': 'Bad\nName' }]) expect(() => testerNames(value)).toThrow()
    const raw = Buffer.from('{"event":"message.received"}')
    expect(verifyZeroSettleSignature(secret, sign(raw, 1000), raw, 1300000)).toBe(true)
    expect(verifyZeroSettleSignature(secret, sign(raw, 1000), raw, 1300001)).toBe(false)
  })
  it('loads only server ZeroSettle settings, with process environment taking precedence', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-private-env-'))
    try {
      fs.writeFileSync(path.join(root, '.env.zeroSettle'), 'ZEROSETTLE_API_KEY=sample-key\nVITE_LEAK=ignored\n')
      fs.writeFileSync(path.join(root, '.env.zerosettle.local'), 'ZEROSETTLE_WEBHOOK_SECRET=sample-secret\n')
      const env = { ZEROSETTLE_API_KEY: 'process-value' }
      loadZeroSettleEnv({ root, env })
      expect(env).toEqual({ ZEROSETTLE_API_KEY: 'process-value', ZEROSETTLE_WEBHOOK_SECRET: 'sample-secret' })
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})
