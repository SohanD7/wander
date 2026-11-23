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
import { parseWandaPoll, POLL_USAGE, pollBoardUrl } from './zerosettle-polls.mjs'
import { zeroSettleSenderId } from './zerosettle.mjs'
const config = { webhookSecret: 'sample-only', chatId: 'iMessage;+;chatPollSample', tripId: PILOT_TRIP_ID,
  testers: ['+12025550101', '+12025550102'], testerNames: { '+12025550101': 'Alice', '+12025550102': 'Bob' }, polls: true, apiKey: 'sample-key', boardBaseUrl: 'https://wander.example.com' }
const command = (id = 800) => ({ event: 'message.received', message: { id, handle: config.testers[0], chat_id: config.chatId,
  kind: 'message', direction: 'in', status: 'received', text: '@Wanda poll Where should we go? | Lisbon | Porto' } })
const voted = (id, handle, options, timestamp = 1000 + id, target = 900) => ({ event: 'poll.voted', message: {
  id, handle, chat_id: config.chatId, kind: 'poll_vote', direction: 'in', status: 'received', ts_ms: timestamp, target_id: target, target_guid: 'native-guid', vote: { option_ids: options }, poll: null,
} })
const accepted = () => Response.json({ ok: true, status: 'message_sent', id: 900, record: { id: 900, kind: 'poll', direction: 'out', status: 'sent', chat_id: config.chatId, guid: 'native-guid',
  poll: { options: [{ id: 'native-lisbon', text: 'Lisbon', votes: 0, voters: [] }, { id: 'native-porto', text: 'Porto', votes: 0, voters: [] }] } } })
const until = async (fn) => { const end = Date.now() + 4000; while (!fn()) { if (Date.now() > end) throw Error('Sync timed out'); await new Promise((r) => setTimeout(r, 10)) } }
async function fixture(run, fetchImpl = async () => accepted(), patch = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-poll-test-'))
  const requests = []
  const opts = { host: '127.0.0.1', port: 0, dataDir, staticDir: '/nonexistent', quiet: true, handleSignals: false, zerosettle: { ...config, ...patch },
    zeroSettleFetch: async (url, init) => { requests.push({ url, ...init, payload: init.body ? JSON.parse(init.body) : undefined }); return fetchImpl(url, init) } }
  let server = await startServer(opts)
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(`ws://127.0.0.1:${server.port}/sync`, `wander-${PILOT_TRIP_ID}`, doc, { WebSocketPolyfill: WebSocket, disableBc: true })
  const serverDoc = () => server.rooms.get(`wander-${PILOT_TRIP_ID}`).doc
  const post = async (payload, invalid = false) => {
    const raw = JSON.stringify(payload), timestamp = Math.floor(Date.now() / 1000)
    const signature = `t=${timestamp},v1=${crypto.createHmac('sha256', config.webhookSecret).update(`${timestamp}.`).update(raw).digest('hex')}`
    return fetch(`http://127.0.0.1:${server.port}/webhooks/zerosettle`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-zerosettle-signature': invalid ? 'invalid' : signature }, body: raw })
  }
  try {
    await new Promise((r) => provider.once('synced', r)); seedPilotTrip(doc)
    await until(() => serverDoc().getMap('meta').get('seeded'))
    await run({ doc, serverDoc, post, requests, restart: async () => { provider.disconnect(); await server.close(); server = await startServer(opts) } })
  } finally { provider.destroy(); doc.destroy(); await server.close(); fs.rmSync(dataDir, { recursive: true, force: true }) }
}
const polls = (doc) => [...doc.getMap('widgets').values()].filter((w) => w.nativePoll)
const state = (doc, id = 'native.zerosettle.message.received.800') => doc.getMap('pilotPollDeliveries').get(id)?.state
const votes = (doc, widgetId, index) => [...doc.getMap('votes').keys()].filter((key) => key.startsWith(`${widgetId}|${widgetId}_o${index}|`)).length

describe('Wanda mechanical poll commands', () => {
  it('parses case-insensitively, trims options and accepts provider boundaries including unicode', () => {
    expect(parseWandaPoll('Wanda poll Where? | Lisbon | Porto').valid).toBe(true)
    expect(parseWandaPoll('  @wAnDa PoLl Where? | Lisbon | Porto  ')).toEqual({ valid: true, question: 'Where?', options: ['Lisbon', 'Porto'] })
    expect(parseWandaPoll('@Wanda poll ' + '😀'.repeat(300) + ' | ' + '🦊'.repeat(150) + ' | B').valid).toBe(true)
    expect(parseWandaPoll('@Wanda poll Q | ' + Array.from({ length: 12 }, (_, i) => i).join('|')).valid).toBe(true)
    for (const text of ['I vote for Lisbon', 'poll Q | A | B', '@Wanda polling Q | A | B']) expect(parseWandaPoll(text)).toBe(null)
  })
  it.each(['@Wanda poll', '@Wanda poll | A | B', '@Wanda poll Q | A', '@Wanda poll Q | Lisbon | LISBON', '@Wanda poll Q | A | ',
    '@Wanda poll ' + 'x'.repeat(301) + '|A|B', '@Wanda poll Q|' + 'x'.repeat(151) + '|B', '@Wanda poll Q|' + Array.from({ length: 13 }, (_, i) => i).join('|')])('rejects invalid syntax or provider constraints: %s', (text) => expect(parseWandaPoll(text)).toEqual({ valid: false }))
  it('offers only usable public HTTPS board links', () => {
    expect(pollBoardUrl(config, 'w1')).toBe('https://wander.example.com/t/pilot-lisbon-demo#widget-w1')
    for (const boardBaseUrl of ['http://127.0.0.1:1241', 'https://192.168.1.1', 'https://wander.local', 'bad']) expect(pollBoardUrl({ ...config, boardBaseUrl }, 'w1')).toBe(null)
  })
})

describe('signed native poll integration', () => {
  it('creates one live canvas poll, persists mapping, replaces multi-selections and removals, and rejects stale events across restart', async () => {
    await fixture(async ({ post, doc, serverDoc, restart, requests }) => {
      const original = command()
      const saved = await (await post(original)).json()
      await until(() => state(serverDoc()) === 'sent' && polls(doc).length === 1)
      expect(requests).toHaveLength(1)
      expect(requests[0].payload).toEqual({ chat_id: config.chatId, poll: { question: 'Where should we go?', options: ['Lisbon', 'Porto'] } })
      expect(requests[0].headers).not.toHaveProperty('Idempotency-Key')
      const w = polls(doc)[0]
      expect(serverDoc().getMap('votes').size).toBe(0)
      expect(serverDoc().getMap('meta').get('destinationPollId')).toBe('w_destination')
      expect(serverDoc().getMap('pilotNativePolls').get(saved.messageId)).toMatchObject({ providerMessageId: '900', providerGuid: 'native-guid', optionMap: { 'native-lisbon': `${w.id}_o0`, 'native-porto': `${w.id}_o1` } })
      const alice = voted(1001, config.testers[0], ['native-lisbon', 'native-porto'], 2000)
      const bob = voted(1002, config.testers[1], ['native-lisbon'], 2001)
      for (const event of [alice, bob]) expect((await post(event)).status).toBe(200)
      await until(() => votes(doc, w.id, 0) === 2 && votes(doc, w.id, 1) === 1)
      expect(doc.getMap('members').get(zeroSettleSenderId(config.testers[0])).name).toBe('Alice')
      // Canvas labels, position and local browser votes remain independently editable.
      const widgets = serverDoc().getMap('widgets')
      widgets.set(w.id, { ...widgets.get(w.id), question: 'Edited on canvas', x: 1200, options: w.options.map((o, i) => ({ ...o, text: i ? 'Oporto' : o.text })) })
      serverDoc().getMap('votes').set(`${w.id}|${w.id}_o0|browser-observer`, 1)
      const changed = voted(1003, config.testers[0], ['native-porto'], 2002)
      await post(changed)
      await until(() => votes(doc, w.id, 0) === 2 && votes(doc, w.id, 1) === 1)
      const removed = voted(1004, config.testers[1], [], 2003)
      await post(removed)
      await until(() => votes(doc, w.id, 0) === 1)
      await restart()
      for (const event of [original, alice, bob, changed, removed]) expect((await (await post(event)).json()).duplicate).toBe(true)
      await post(voted(1005, config.testers[0], ['native-lisbon'], 1999))
      expect(votes(serverDoc(), w.id, 0)).toBe(1)
      expect(votes(serverDoc(), w.id, 1)).toBe(1)
      expect(serverDoc().getMap('widgets').get(w.id)).toMatchObject({ question: 'Edited on canvas', x: 1200 })
      expect(requests).toHaveLength(1)
      const guidOnly = voted(1006, config.testers[0], [], 2004); delete guidOnly.message.target_id
      await post(guidOnly)
      expect(votes(serverDoc(), w.id, 1)).toBe(0)
      // Same timestamp: provider message ID is a deterministic tiebreaker.
      await post(voted(1010, config.testers[0], ['native-lisbon'], 3000))
      await post(voted(1009, config.testers[0], ['native-porto'], 3000))
      expect(votes(serverDoc(), w.id, 1)).toBe(0)
    })
  })
  it('sends one usage explanation for an invalid command, with no destination votes, cards or link capture', async () => {
    await fixture(async ({ post, serverDoc, requests, restart }) => {
      const payload = command(); payload.message.text = '@Wanda poll Q | Lisbon https://example.com | Lisbon https://example.com'
      expect((await (await post(payload)).json()).usage).toBe(POLL_USAGE)
      await until(() => requests.length === 1 && state(serverDoc(), 'reply.zerosettle.message.received.800') === 'sent')
      expect(requests[0].payload.text).toBe(POLL_USAGE)
      expect(serverDoc().getMap('widgets').size).toBe(1)
      expect(serverDoc().getMap('votes').size).toBe(0)
      await restart(); await post(payload)
      expect(requests).toHaveLength(1)
    })
  })
  it('rejects signatures, wrong groups, unknown testers and malformed selections; ignores unknown polls and outbound events', async () => {
    await fixture(async ({ post, serverDoc, requests }) => {
      await post(command()); await until(() => state(serverDoc()) === 'sent')
      const conflicting = command(); conflicting.message.text = '@Wanda poll Other? | A | B'
      expect((await post(conflicting)).status).toBe(409)
      const before = serverDoc().getMap('votes').size
      const event = voted(1100, config.testers[0], ['native-lisbon'])
      expect((await post(event, true)).status).toBe(401)
      for (const patch of [{ chat_id: 'iMessage;+;other' }, { handle: '+12025550199' }, { chat_id: undefined }]) expect((await post({ ...event, message: { ...event.message, ...patch } })).status).toBe(403)
      for (const patch of [{ ts_ms: undefined }, { vote: { option_ids: ['native-lisbon', 'native-lisbon'] } }, { vote: { option_ids: 'native-lisbon' } }]) expect((await post({ ...event, message: { ...event.message, ...patch } })).status).toBe(400)
      expect((await (await post({ ...event, message: { ...event.message, vote: { option_ids: ['unknown-option'] } } })).json()).state).toBe('invalid_options')
      const unknown = voted(1101, config.testers[0], ['native-lisbon'], 3000, 999); unknown.message.target_guid = 'unknown-guid'
      expect((await (await post(unknown)).json()).state).toBe('unknown_poll')
      for (const payload of [{ ...event, event: 'message.sent' }, { ...event, event: 'message.failed' }, { ...event, message: { ...event.message, direction: 'out' } }]) expect((await (await post(payload)).json()).ignored).toBeTruthy()
      expect(serverDoc().getMap('votes').size).toBe(before)
      expect(requests).toHaveLength(1)
    })
  })
  it('buffers a vote racing the send response, including restart, without attaching it to an unknown poll', async () => {
    let release
    const held = new Promise((resolve) => { release = resolve })
    await fixture(async ({ post, serverDoc, restart, requests }) => {
      await post(command()); await until(() => requests.length === 1)
      expect((await (await post(voted(1200, config.testers[0], ['native-porto']))).json()).state).toBe('waiting')
      expect(serverDoc().getMap('votes').size).toBe(0)
      release(accepted()); await until(() => state(serverDoc()) === 'sent')
      expect(votes(serverDoc(), polls(serverDoc())[0].id, 1)).toBe(1)
      expect(serverDoc().getMap('pilotPendingPollVotes').size).toBe(0)
      await restart(); await post(voted(1200, config.testers[0], ['native-porto']))
      expect(requests).toHaveLength(1)
    }, () => held)
  })
  it('resumes unclaimed work after restart but never repeats an in-flight poll send', async () => {
    let calls = 0
    await fixture(async ({ post, serverDoc, restart, requests }) => {
      await post(command()); await until(() => requests.length === 1)
      await post(command(801))
      expect(state(serverDoc(), 'native.zerosettle.message.received.801')).toBe('pending')
      await restart()
      await until(() => state(serverDoc(), 'native.zerosettle.message.received.801') === 'sent')
      expect(state(serverDoc())).toBe('uncertain')
      await post(command()); await post(command(801))
      expect(requests).toHaveLength(2)
      expect(polls(serverDoc())).toHaveLength(2)
    }, () => ++calls === 1 ? new Promise(() => {}) : accepted())
  })
  it.each([
    ['unsupported line', () => Response.json({ error: { code: 'poll_unsupported' } }, { status: 409 }), 'failed', 2],
    ['permission refusal', () => Response.json({}, { status: 403 }), 'failed', 2],
    ['upstream failure', () => Response.json({}, { status: 503 }), 'uncertain', 1],
    ['transport timeout', () => { throw Error('sample timeout') }, 'uncertain', 1],
    ['malformed success', () => Response.json({ ok: true }), 'uncertain', 1],
  ])('records %s without duplicate sends on retry or restart', async (_name, reply, expected, count) => {
    await fixture(async ({ post, serverDoc, restart, requests }) => {
      await post(command()); await until(() => state(serverDoc()) === expected)
      if (count === 2) await until(() => state(serverDoc(), 'reply.zerosettle.message.received.800') === 'sent')
      expect(polls(serverDoc())[0].nativePoll.state).toBe(expected)
      if (count === 2) {
        expect(requests[1].payload.text).toContain('https://wander.example.com/t/pilot-lisbon-demo#widget-')
        expect(requests[1].payload.text).not.toContain('sent the native poll')
      }
      await restart(); await post(command())
      expect(polls(serverDoc())).toHaveLength(1)
      expect(requests).toHaveLength(count)
    }, (_url, init) => JSON.parse(init.body).poll ? reply() : Response.json({ ok: true, status: 'message_sent', id: 901 }))
  })
  it('does not send until the durable claim is saved; safely resumes after a failed claim', async () => {
    await fixture(async ({ post, serverDoc, requests }) => {
      const rename = fs.renameSync; let writes = 0
      const spy = vi.spyOn(fs, 'renameSync').mockImplementation((...args) => { if (++writes === 2) throw Error('sample disk failure'); return rename(...args) })
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      try { await post(command()) } finally { spy.mockRestore(); log.mockRestore() }
      expect(requests).toHaveLength(0); expect(state(serverDoc())).toBe('pending')
      await post(command()); await until(() => state(serverDoc()) === 'sent')
      expect(requests).toHaveLength(1)
    })
  })

  it('resolves a missing send record with a safe GET, without repeating the native POST', async () => {
    await fixture(async ({ post, serverDoc, requests, restart }) => {
      await post(command()); await until(() => state(serverDoc()) === 'sent')
      expect(requests.map((r) => r.method ?? 'GET')).toEqual(['POST', 'GET'])
      expect(requests[1].url).toBe('https://portal.zerosettle.io/api/imessage/messages/900/poll')
      await restart(); await post(command())
      expect(requests).toHaveLength(2)
    }, async (_url, init) => init.method === 'POST' ? Response.json({ ok: true, status: 'message_sent', id: 900 }) : Response.json((await accepted().json()).record))
  })
  it('retains an accepted ID when mapping lookup fails and recovers from a signed snapshot after restart', async () => {
    await fixture(async ({ post, serverDoc, requests, restart }) => {
      await post(command()); await until(() => state(serverDoc()) === 'uncertain')
      expect(serverDoc().getMap('pilotNativePolls').get('zerosettle.message.received.800').providerMessageId).toBe('900')
      expect((await (await post(voted(1499, config.testers[1], ['native-lisbon']))).json()).state).toBe('waiting')
      await restart()
      const event = voted(1500, config.testers[0], ['native-porto'])
      event.message.poll = (await accepted().json()).record.poll
      expect((await (await post(event)).json()).state).toBe('applied')
      expect(votes(serverDoc(), polls(serverDoc())[0].id, 1)).toBe(1)
      expect(votes(serverDoc(), polls(serverDoc())[0].id, 0)).toBe(1)
      expect(serverDoc().getMap('pilotPendingPollVotes').size).toBe(0)
      expect(state(serverDoc())).toBe('sent')
      expect(requests).toHaveLength(2) // one POST and its failed read; no repeat send
    }, (_url, init) => init.method === 'POST' ? Response.json({ ok: true, status: 'message_sent', id: 900 }) : Response.json({}, { status: 503 }))
  })
  it('does not send if saving the command fails, or repeat a send if saving its outcome fails', async () => {
    await fixture(async ({ post, requests, restart, serverDoc }) => {
      const rename = fs.renameSync
      let writes = 0
      const spy = vi.spyOn(fs, 'renameSync').mockImplementation((...args) => { if (++writes === 1) throw Error('sample ingress persistence failure'); return rename(...args) })
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      try { expect((await post(command())).status).toBe(503) } finally { spy.mockRestore(); log.mockRestore() }
      expect(requests).toHaveLength(0)
      await post(command()); await until(() => state(serverDoc()) === 'sent')
      await restart(); await post(command())
      expect(requests).toHaveLength(1)
    })
    let release
    const pending = new Promise((r) => { release = r })
    await fixture(async ({ post, requests, restart, serverDoc }) => {
      await post(command()); await until(() => state(serverDoc()) === 'sending')
      const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Error('sample outcome persistence failure') })
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      // Keep disk unavailable through shutdown: only the already-saved sending claim survives.
      try { release(accepted()); await until(() => state(serverDoc()) === 'sent'); await restart() } finally { spy.mockRestore(); log.mockRestore() }
      await post(command())
      expect(state(serverDoc())).toBe('uncertain')
      expect(requests).toHaveLength(1)
    }, () => pending)
  })
  it('never repeats a failed or uncertain usage/fallback reply and avoids loopback board links', async () => {
    await fixture(async ({ post, requests, serverDoc, restart }) => {
      await post(command()); await until(() => state(serverDoc(), 'reply.zerosettle.message.received.800') === 'uncertain')
      expect(requests[1].payload.text).toContain('saved on the Wander board')
      expect(requests[1].payload.text).not.toContain('127.0.0.1')
      await restart(); await post(command())
      expect(requests).toHaveLength(2)
    }, (_url, init) => JSON.parse(init.body).poll ? Response.json({ error: { code: 'poll_unsupported' } }, { status: 409 }) : Promise.reject(Error('sample reply timeout')), { boardBaseUrl: 'http://127.0.0.1:1241' })
  })
  it('fails closed without an API key, and keeps native sends off until explicitly enabled', async () => {
    await fixture(async ({ post, serverDoc, requests }) => {
      expect((await (await post(command())).json()).ignored).toBe('native polls disabled')
      expect((await (await post(voted(1600, config.testers[0], []))).json()).ignored).toBe('native polls disabled')
      expect(polls(serverDoc())).toHaveLength(0)
      expect(requests).toHaveLength(0)
    }, undefined, { polls: false })
    const { createPilotPolls } = await import('./zerosettle-polls.mjs')
    expect(() => createPilotPolls({ config: { ...config, apiKey: '' } })).toThrow('server API key')
  })

  it('does not recreate deleted native cards or undo removed canvas options', async () => {
    await fixture(async ({ post, serverDoc, restart }) => {
      await post(command()); await until(() => state(serverDoc()) === 'sent')
      const w = polls(serverDoc())[0], widgets = serverDoc().getMap('widgets')
      widgets.set(w.id, { ...w, options: [w.options[0]] })
      await post(voted(1300, config.testers[0], ['native-porto']))
      expect(serverDoc().getMap('votes').size).toBe(0)
      widgets.delete(w.id)
      await restart(); await post(command()); await post(voted(1301, config.testers[0], ['native-lisbon']))
      expect(polls(serverDoc())).toHaveLength(0)
    })
  })
})
