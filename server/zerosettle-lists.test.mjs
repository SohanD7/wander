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
import { parseWandaList, listKey } from './zerosettle-lists.mjs'
import { checklistItems, ensureChecklist, appendChecklistItems, editChecklistItem, removeChecklistItem } from '../src/collab/checklists.mjs'
import { zeroSettleSenderId } from './zerosettle.mjs'
const config = { webhookSecret: 'sample-only', chatId: 'iMessage;+;chatPollSample', tripId: PILOT_TRIP_ID,
  testers: ['+12025550101', '+12025550102'], testerNames: { '+12025550101': 'Alice', '+12025550102': 'Bob' }, lists: true, polls: false, apiKey: 'sample-key', boardBaseUrl: 'https://wander.example.com' }
const command = (id = 800) => ({ event: 'message.received', message: { id, handle: config.testers[0], chat_id: config.chatId,
  kind: 'message', direction: 'in', status: 'received', text: '@Wanda list Packing | Passport | Charger | Sunscreen' } })
const accepted = () => Response.json({ ok: true, status: 'message_sent', id: 900 })
const until = async (fn) => { const end = Date.now() + 4000; while (!fn()) { if (Date.now() > end) throw Error('Sync timed out'); await new Promise((r) => setTimeout(r, 10)) } }
async function fixture(run, fetchImpl = async () => accepted(), patch = {}, legacySeed) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-poll-test-'))
  const requests = []
  const opts = { host: '127.0.0.1', port: 0, dataDir, staticDir: '/nonexistent', quiet: true, handleSignals: false, zerosettle: { ...config, ...patch },
    zeroSettleFetch: async (url, init) => { requests.push({ url, ...init, payload: init.body ? JSON.parse(init.body) : undefined }); return fetchImpl(url, init) } }
  if (legacySeed) {
    const saved = new Y.Doc(); seedPilotTrip(saved); legacySeed(saved)
    fs.writeFileSync(path.join(dataDir, crypto.createHash('sha256').update(`wander-${PILOT_TRIP_ID}`).digest('hex').slice(0, 32) + '.ydoc'), Y.encodeStateAsUpdate(saved)); saved.destroy()
  }
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
const message = (id, text) => ({ ...command(id), message: { ...command(id).message, text } })
const lists = (doc) => [...doc.getMap('widgets').values()].filter((w) => w.type === 'checklist')
const state = (doc, id = 800) => doc.getMap('pilotListDeliveries').get(`zerosettle.message.received.${id}`)?.state

describe('deterministic checklist syntax', () => {
  it('accepts literal and observed native mention prefixes case-insensitively; treats content plainly', () => {
    expect(parseWandaList(' wAnDa LiSt Packing | Passport | https://example.com ')).toEqual({ valid: true, action: 'list', title: 'Packing', items: ['Passport', 'https://example.com'] })
    expect(parseWandaList('@Wanda ADD TO Packing | Sunglasses').action).toBe('add')
    expect(parseWandaList('@Wanda done Packing | Passport').action).toBe('done')
    expect(parseWandaList('@Wanda undo Packing | Passport').action).toBe('undo')
    expect(listKey('  Sun   Glasses  ')).toBe('sun glasses')
    for (const text of ['Wander list Packing | A', 'hello @Wanda list Packing | A', '@Wanda poll Q | A | B', 'list Packing | A']) expect(parseWandaList(text)).toBe(null)
  })
  it.each([
    ['@Wanda list', 'list name'], ['@Wanda list Packing', 'item'], ['@Wanda list Packing |', 'item'],
    ['@Wanda add Packing | A', '‘to’ after ‘add’'], ['@Wanda done Packing | A | B', 'exactly one'],
    ['@Wanda list Q | Passport | passport', 'more than once'], ['@Wanda list ' + 'x'.repeat(81) + '|A', '80'],
    ['@Wanda list Q|' + 'x'.repeat(201), '200'], ['@Wanda list Q|' + Array.from({ length: 21 }, (_, i) => i).join('|'), '20'],
    ['@Wanda list Q|A\nB', 'single-line'], ['@Wanda list Q|' + 'x'.repeat(4001), '4,000'],
  ])('gives problem-specific validation for %s', (text, problem) => {
    expect(parseWandaList(text)).toMatchObject({ valid: false })
    expect(parseWandaList(text).reply).toContain(problem)
    expect(parseWandaList(text).reply).not.toContain('Example:')
    expect(parseWandaList(text).reply).not.toContain('Packing')
  })
})

describe('signed checklist actions', () => {
  it('creates live attributed lists, appends without resetting state, and keeps done/undo idempotent across replay/restart', async () => {
    await fixture(async ({ post, doc, serverDoc, restart, requests }) => {
      const first = command(), result = await (await post(first)).json()
      expect(result.reply).toBe('Created Packing with 3 items.')
      await until(() => lists(doc).length === 1 && state(serverDoc()) === 'sent')
      const w = lists(doc)[0], originalIds = checklistItems(doc, w).map((item) => item.id)
      expect(w.source).toMatchObject({ senderId: zeroSettleSenderId(config.testers[0]), author: 'Alice' })
      expect(serverDoc().getArray('feed').get(0)).toMatchObject({ by: 'Alice', byId: w.source.senderId })
      expect(serverDoc().getMap('votes').size).toBe(0)
      const added = message(801, 'Wanda ADD TO packing | Water bottle | Sunglasses')
      expect((await (await post(added)).json()).reply).toBe('Added 2 items to Packing.')
      const done = message(802, '@Wanda DONE PACKING | passport')
      await post(done)
      const passportKey = `${w.id}|${originalIds[0]}`
      await until(() => doc.getMap('checks').get(passportKey) === true)
      expect((await (await post(message(803, '@Wanda done Packing | Passport'))).json()).reply).toContain('already complete')
      const undo = message(804, '@Wanda undo Packing | Passport')
      await post(undo)
      expect(serverDoc().getMap('checks').get(passportKey)).toBe(false)
      expect((await (await post(message(805, '@Wanda undo Packing | Passport'))).json()).reply).toContain('already incomplete')
      await until(() => requests.length === 6 && state(serverDoc(), 805) === 'sent')
      expect(requests.every((r) => r.payload.chat_id === config.chatId && !r.headers['Idempotency-Key'])).toBe(true)
      await restart()
      for (const event of [first, added, done, undo]) expect((await (await post(event)).json()).duplicate).toBe(true)
      expect(checklistItems(serverDoc(), lists(serverDoc())[0])).toHaveLength(5)
      expect(checklistItems(serverDoc(), lists(serverDoc())[0]).slice(0, 3).map((i) => i.id)).toEqual(originalIds)
      expect(serverDoc().getMap('checks').get(passportKey)).toBe(false) // replaying old done must not override later undo
      expect(requests).toHaveLength(6)
      expect((await post(message(800, '@Wanda list Other | A'))).status).toBe(409)
    })
  })
  it('reports existing items and appends only new ones, preserving user edits and completion', async () => {
    await fixture(async ({ post, doc, serverDoc }) => {
      await post(command()); await until(() => lists(doc).length === 1)
      const w = lists(doc)[0], widgets = doc.getMap('widgets'), original = checklistItems(doc, w)
      // Browser edits flow through its ordinary shared objects before the next chat action.
      widgets.set(w.id, { ...w, title: 'Travel kit', x: 1200, y: 1700, w: 480, h: 600 })
      editChecklistItem(doc, w, original[0].id, 'Photo ID')
      doc.getMap('checks').set(`${w.id}|${original[1].id}`, true)
      await until(() => serverDoc().getMap('widgets').get(w.id).title === 'Travel kit' && checklistItems(serverDoc(), w)[0].text === 'Photo ID')
      const result = await (await post(message(810, '@Wanda add to TRAVEL KIT | photo id | Water bottle'))).json()
      expect(result.reply).toContain('Added 1 item')
      expect(result.reply).toContain('Already present: photo id')
      expect(serverDoc().getMap('widgets').get(w.id)).toMatchObject({ title: 'Travel kit', x: 1200, y: 1700, w: 480, h: 600 })
      expect(serverDoc().getMap('checks').get(`${w.id}|${original[1].id}`)).toBe(true)
      await post(message(811, '@Wanda done travel kit | PHOTO ID'))
      expect(serverDoc().getMap('checks').get(`${w.id}|${original[0].id}`)).toBe(true)
      const again = await (await post(message(812, '@Wanda add to Travel kit | Photo ID'))).json()
      expect(again.changed).toBe(false)
      expect(again.reply).toBe('Already in Travel kit: Photo ID. Add a different item.')
      expect(checklistItems(serverDoc(), w)).toHaveLength(4)
    })
  })
  it('clarifies duplicate lists/items and specifically explains missing lists/items and existing titles without mutations', async () => {
    await fixture(async ({ post, serverDoc }) => {
      await post(command())
      const w = lists(serverDoc())[0]
      const before = JSON.stringify([...serverDoc().getMap('widgets')])
      for (const [id, text, explanation] of [
        [820, '@Wanda list PACKING | New', 'PACKING already exists. Choose a different list name.'], [821, '@Wanda add to Missing | A', 'I couldn’t find a list called Missing. Check the list name.'],
        [822, '@Wanda done Packing | SPF 50', 'I couldn’t find ‘SPF 50’ in Packing. To add it:\n@Wanda add to Packing | SPF 50'],
      ]) { expect((await (await post(message(id, text))).json()).reply).toBe(explanation); expect(JSON.stringify([...serverDoc().getMap('widgets')])).toBe(before) }
      appendChecklistItems(serverDoc(), w, [{ id: 'duplicate-passport', text: 'PASSPORT' }])
      const itemsBefore = checklistItems(serverDoc(), w)
      expect((await (await post(message(823, '@Wanda done Packing | Passport'))).json()).reply).toBe('I found more than one ‘Passport’ in Packing. Give them distinct names on the canvas.')
      expect((await (await post(message(824, '@Wanda add to Packing | Passport | New'))).json()).reply).toBe('I found more than one ‘Passport’ in Packing. Give them distinct names on the canvas.')
      expect(checklistItems(serverDoc(), w)).toEqual(itemsBefore)
      expect(serverDoc().getMap('checks').size).toBe(0)
      serverDoc().getMap('widgets').set('duplicate-list', { ...w, id: 'duplicate-list', title: ' packing ' })
      expect((await (await post(message(825, '@Wanda undo Packing | Passport'))).json()).reply).toBe('I found more than one list called Packing. Give them distinct names on the canvas.')
    })
  })
  it('retains legacy persisted IDs/checks and assigns missing IDs once, across restart', async () => {
    await fixture(async ({ post, serverDoc, restart }) => {
      const w = serverDoc().getMap('widgets').get('legacy')
      const items = checklistItems(serverDoc(), w)
      expect(items[0].id).toBe('stable-passport')
      expect(serverDoc().getMap('checks').get('legacy|stable-passport')).toBe(true)
      expect(items[1].id).toBe('legacy_1')
      await post(message(830, '@Wanda done Legacy | Charger'))
      await post(message(831, '@Wanda add to Legacy | Water'))
      await restart()
      const reloaded = serverDoc().getMap('widgets').get('legacy')
      expect(reloaded).toMatchObject({ x: 660, y: 888, title: 'Legacy' })
      expect(checklistItems(serverDoc(), reloaded).map((i) => i.id).slice(0, 2)).toEqual(items.map((i) => i.id))
      expect(serverDoc().getMap('checks').get('legacy|legacy_1')).toBe(true)
      await post(message(832, '@Wanda undo Legacy | Passport'))
      expect(serverDoc().getMap('checks').get('legacy|stable-passport')).toBe(false)
    }, undefined, {}, (doc) => {
      doc.getMap('widgets').set('legacy', { id: 'legacy', type: 'checklist', title: 'Legacy', x: 660, y: 888, z: 3, items: [{ id: 'stable-passport', text: 'Passport' }, { text: 'Charger' }] })
      doc.getMap('checks').set('legacy|stable-passport', true)
    })
  })
  it('rejects unauthorized/signature/outbound events; intercepts item URLs and vote-looking text', async () => {
    await fixture(async ({ post, serverDoc, requests }) => {
      expect((await post(command(), true)).status).toBe(401)
      for (const patch of [{ chat_id: 'iMessage;+;other' }, { handle: '+12025550199' }]) expect((await post({ ...command(), message: { ...command().message, ...patch } })).status).toBe(403)
      for (const payload of [{ ...command(), event: 'message.sent' }, { ...command(), message: { ...command().message, direction: 'out' } }]) expect((await (await post(payload)).json()).ignored).toBeTruthy()
      expect(serverDoc().getMap('widgets').size).toBe(1)
      expect(requests).toHaveLength(0)
      await post(message(840, '@Wanda list Links | https://example.com | I vote for Lisbon'))
      await until(() => state(serverDoc(), 840) === 'sent')
      expect(lists(serverDoc())).toHaveLength(1)
      expect([...serverDoc().getMap('widgets').values()].filter((w) => w.type === 'note')).toHaveLength(0)
      expect(serverDoc().getMap('votes').size).toBe(0)
    })
  })
  it.each([
    ['refusal', () => Response.json({}, { status: 403 }), 'failed'],
    ['upstream error', () => Response.json({}, { status: 503 }), 'uncertain'],
    ['network failure', () => { throw Error('sample failure') }, 'uncertain'],
  ])('retains mutations and never repeats replies after %s', async (_name, reply, expected) => {
    await fixture(async ({ post, serverDoc, requests, restart }) => {
      await post(command()); await until(() => state(serverDoc()) === expected)
      await restart(); await post(command())
      expect(lists(serverDoc())).toHaveLength(1)
      expect(checklistItems(serverDoc(), lists(serverDoc())[0])).toHaveLength(3)
      expect(requests).toHaveLength(1)
      expect(state(serverDoc())).toBe(expected)
    }, reply)
  })
  it('resumes an unclaimed reply after restart, without repeating an in-flight reply or mutations', async () => {
    let calls = 0
    await fixture(async ({ post, serverDoc, restart, requests }) => {
      await post(command()); await until(() => requests.length === 1)
      await post(message(851, '@Wanda add to Packing | Water'))
      expect(state(serverDoc(), 851)).toBe('pending')
      await restart(); await until(() => state(serverDoc(), 851) === 'sent')
      expect(state(serverDoc())).toBe('uncertain')
      await post(command()); await post(message(851, '@Wanda add to Packing | Water'))
      expect(checklistItems(serverDoc(), lists(serverDoc())[0])).toHaveLength(4)
      expect(requests).toHaveLength(2)
    }, () => ++calls === 1 ? new Promise(() => {}) : accepted())
  })
  it('does not send before mutation/receipt and claim saves succeed', async () => {
    await fixture(async ({ post, serverDoc, requests }) => {
      const rename = fs.renameSync; let writes = 0
      const spy = vi.spyOn(fs, 'renameSync').mockImplementation((...args) => { if (++writes === 2) throw Error('claim save failed'); return rename(...args) })
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      try { await post(command()) } finally { spy.mockRestore(); log.mockRestore() }
      expect(requests).toHaveLength(0)
      expect(state(serverDoc())).toBe('pending')
      await post(command()); await until(() => state(serverDoc()) === 'sent')
      expect(lists(serverDoc())).toHaveLength(1)
      expect(requests).toHaveLength(1)
    })
  })
  it('enforces the per-list item limit without truncation or partial changes', async () => {
    await fixture(async ({ post, serverDoc }) => {
      await post(command())
      const w = lists(serverDoc())[0]
      appendChecklistItems(serverDoc(), w, Array.from({ length: 97 }, (_, i) => ({ id: `limit-${i}`, text: `Existing ${i}` })))
      expect((await (await post(message(860, '@Wanda add to Packing | One more'))).json()).reply).toContain('exceed 100')
      expect(checklistItems(serverDoc(), w)).toHaveLength(100)
    })
  })
  it('keeps recognized commands isolated when the feature is disabled', async () => {
    await fixture(async ({ post, serverDoc, requests }) => {
      const result = await (await post(message(870, '@Wanda list Links | https://example.com'))).json()
      expect(result.ignored).toBe('checklist commands disabled')
      expect(serverDoc().getMap('widgets').size).toBe(1)
      expect(requests).toHaveLength(0)
    }, undefined, { lists: false })
  })
})

describe('granular checklist collaboration', () => {
  it('merges simultaneous browser edits/removal/addition and relay additions without losing unrelated items or movement', () => {
    const server = new Y.Doc(), browser = new Y.Doc()
    const w = { id: 'list', type: 'checklist', title: 'Packing', x: 0, y: 0, z: 1, items: [{ id: 'passport', text: 'Passport' }, { id: 'charger', text: 'Charger' }] }
    server.getMap('widgets').set(w.id, w); ensureChecklist(server, w)
    Y.applyUpdate(browser, Y.encodeStateAsUpdate(server))
    appendChecklistItems(server, w, [{ id: 'chat-water', text: 'Water' }])
    editChecklistItem(browser, w, 'passport', 'Photo ID')
    removeChecklistItem(browser, w, 'charger')
    appendChecklistItems(browser, w, [{ id: 'browser-hat', text: 'Hat' }])
    browser.getMap('widgets').set(w.id, { ...w, x: 500, title: 'Travel kit' })
    browser.getMap('checks').set('list|passport', true)
    const serverUpdate = Y.encodeStateAsUpdate(server), browserUpdate = Y.encodeStateAsUpdate(browser)
    Y.applyUpdate(server, browserUpdate); Y.applyUpdate(browser, serverUpdate)
    expect(checklistItems(server, w)).toEqual(checklistItems(browser, w))
    expect(new Set(checklistItems(server, w).map((i) => i.text))).toEqual(new Set(['Photo ID', 'Water', 'Hat']))
    expect(server.getMap('widgets').get('list')).toMatchObject({ x: 500, title: 'Travel kit' })
    expect(server.getMap('checks').get('list|passport')).toBe(true)
    server.destroy(); browser.destroy()
  })
})
