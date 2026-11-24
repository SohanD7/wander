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
import { parseWandaBudget } from './zerosettle-budget.mjs'
import { parseWandaPlace } from './zerosettle-places.mjs'
import { parseBudgetAmount, amountText, budgetSummary, tripFinances } from '../src/collab/pilot-budget.mjs'
import { parseMapLink, parseCoordinates } from '../src/collab/pilot-places.mjs'
import { zeroSettleSenderId } from './zerosettle.mjs'
const config = { webhookSecret: 'sample-only', chatId: 'iMessage;+;chatPollSample', tripId: PILOT_TRIP_ID,
  testers: ['+12025550101', '+12025550102', '+12025550103'], testerNames: { '+12025550101': 'Alice', '+12025550102': 'Bob', '+12025550103': 'Cara' }, budgets: true, places: true, geocoderEnabled: true, geocoderUrl: 'https://photon.example/api/', polls: false, apiKey: 'sample-key', boardBaseUrl: 'https://wander.example.com' }
const command = (id = 800) => ({ event: 'message.received', message: { id, handle: config.testers[0], chat_id: config.chatId,
  kind: 'message', direction: 'in', status: 'received', text: '@Wanda budget USD 600 per person' } })
const accepted = () => Response.json({ ok: true, status: 'message_sent', id: 900 })
const until = async (fn) => { const end = Date.now() + 4000; while (!fn()) { if (Date.now() > end) throw Error('Sync timed out'); await new Promise((r) => setTimeout(r, 10)) } }
async function fixture(run, fetchImpl = async () => accepted(), patch = {}, legacySeed, geocode = async () => geoResult()) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-poll-test-'))
  const requests = [], lookups = []
  const opts = { host: '127.0.0.1', port: 0, dataDir, staticDir: '/nonexistent', quiet: true, handleSignals: false, zerosettle: { ...config, ...patch },
    geocodeFetch: async (url, init) => { lookups.push({ url, ...init }); return geocode(url, init) },
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
    await new Promise((r) => provider.once('synced', r)); if (!doc.getMap('meta').get('seeded')) seedPilotTrip(doc)
    await until(() => serverDoc().getMap('meta').get('seeded'))
    await run({ doc, serverDoc, post, requests, lookups, restart: async () => { provider.disconnect(); await server.close(); server = await startServer(opts) } })
  } finally { provider.destroy(); doc.destroy(); await server.close(); fs.rmSync(dataDir, { recursive: true, force: true }) }
}
const message = (id, text) => ({ ...command(id), message: { ...command(id).message, text } })
const idFor = zeroSettleSenderId
const featureCards = (doc, purpose) => [...doc.getMap('widgets').values()].filter((w) => w.purpose === purpose)
const pref = (doc, index = 0) => doc.getMap('budgetPreferences').get(idFor(config.testers[index]))
const state = (doc, id = 800, map = 'pilotBudgetDeliveries') => doc.getMap(map).get(`zerosettle.message.received.${id}`)?.state
const feature = (name = 'Pike Place Market', lon = -122.34, lat = 47.61, osm_id = 1) => ({ geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name, city: 'Seattle', country: 'United States', osm_type: 'N', osm_id } })
const geoResult = (features = [feature()]) => Response.json({ features })
const asTester = (event, index) => ({ ...event, message: { ...event.message, handle: config.testers[index] } })
async function lookupPlace(post, serverDoc, id = 900, text = '@Wanda place Pike Place Market, Seattle') {
 const response = await (await post(message(id, text))).json()
 await until(() => state(serverDoc(), id, 'pilotPlaceDeliveries') === 'sent')
 return serverDoc().getMap('pendingPlaces').get(response.pendingId)
}
describe('exact pilot money and deterministic commands', () => {
  it('parses supported currency precisions with integer arithmetic, including zero', () => {
    expect(parseBudgetAmount('usd', '600.10')).toEqual({ currency: 'USD', minor: 60010 })
    expect(parseBudgetAmount('KWD', '0.001')).toEqual({ currency: 'KWD', minor: 1 })
    expect(parseBudgetAmount('BHD', '10.125')).toEqual({ currency: 'BHD', minor: 10125 })
    expect(parseBudgetAmount('JPY', '600')).toEqual({ currency: 'JPY', minor: 600 })
    expect(parseBudgetAmount('USD', '0')).toEqual({ currency: 'USD', minor: 0 })
    expect(amountText({ currency: 'KWD', minor: 10125 })).toBe('KWD 10.125')
    expect(parseWandaBudget('Wanda BUDGET usd 600 per PERSON')).toMatchObject({ action: 'set', minor: 60000 })
    expect(budgetSummary({ a: { name: 'A' }, b: { name: 'B' } }, { a: { currency: 'USD', minor: 60000 }, b: { currency: 'USD', minor: 80000 } })).toContain('Range: USD 600.00–USD 800.00')
    expect(parseWandaBudget('@Wanda budget clear')).toEqual({ action: 'clear' })
    expect(parseWandaBudget('@Wanda budget summary')).toEqual({ action: 'summary' })
  })
  it.each([['JPY', '1.1'], ['USD', '0.001'], ['USD', '-1'], ['USD', '1e2'], ['USD', '1,000'], ['USD', '1000000000'], ['ZZZ', '10'], ['USD', 'Infinity']])('rejects invalid %s %s', (currency, amount) => expect(parseBudgetAmount(currency, amount).error).toBeTruthy())
  it('requires explicit currency and scope', () => {
    for (const text of ['@Wanda budget 600', '@Wanda budget $600 per person', '@Wanda budget USD 600', '@Wanda budget USD 600 per day']) expect(parseWandaBudget(text).error).toContain('@Wanda budget USD 600 per person')
    expect(parseWandaBudget('my budget is 600')).toBe(null)
  })
  it('subtracts legacy USD spending from the group target and keeps mixed currencies separate', () => {
    const meta = { budget: 500 }
    const expenses = [{ amount: 84.50 }, { currency: 'USD', minor: 220 }]
    expect(tripFinances(meta, expenses)).toEqual({
      preferred: 'USD', target: { currency: 'USD', minor: 50000 },
      spending: [{ currency: 'USD', minor: 8670 }], remaining: { currency: 'USD', minor: 41330 },
    })
    const foreign = { currency: 'JPY', minor: 1250 }
    expect(tripFinances(meta, [...expenses, foreign])).toMatchObject({
      spending: [{ currency: 'USD', minor: 8670 }, foreign], remaining: null,
    })
    expect(tripFinances({}, [...expenses, foreign]).preferred).toBeNull()
    expect(tripFinances(meta, [{ currency: 'USD', minor: 50100 }]).remaining.minor).toBe(-100)
  })
  it('uses documented Google search coordinates, not viewport centers, and rejects unsafe URLs/ranges', () => {
    expect(parseMapLink('https://www.google.com/maps/search/?api=1&query=47.6,-122.3').coordinates).toEqual({ lat: 47.6, lon: -122.3 })
    expect(parseMapLink('https://www.google.com/maps/@47.6,-122.3,14z').coordinates).toBe(null)
    expect(parseMapLink('https://maps.app.goo.gl/sample').coordinates).toBe(null)
    expect(parseMapLink('https://www.google.com/maps/search/?api=1&query=47,-122&query_place_id=x').coordinates).toBe(null)
    for (const url of ['http://www.google.com/maps/', 'https://www.google.com.evil.example/maps/', 'https://user:secret@www.google.com/maps/', 'https://127.0.0.1/maps/', 'javascript:alert(1)', 'https://www.google.com:444/maps/', 'https://www.google.com/maps/search/?api=1&query=91,0']) expect(parseMapLink(url).error).toBeTruthy()
    for (const text of ['91,0', '0,181', 'NaN,0', '1e2,0']) expect(parseCoordinates(text)).toBe(null)
    expect(parseWandaPlace('Wanda places')).toEqual({ action: 'list' })
  })
})

describe('budget preferences in the existing trip document', () => {
  it('requires usable expense data and explicit currency when the ledger has no single currency', async () => {
    await fixture(async ({ post, serverDoc }) => {
      const ledger = serverDoc().getMap('expenses')
      for (const [index, text] of ['@Wanda expense USD 0 | Dinner', '@Wanda expense USD 8.005 | Dinner', '@Wanda expense $84.50 |'].entries()) {
        const reply = await (await post(message(830 + index, text))).json()
        expect(reply.reply).toContain('@Wanda expense USD 84.50 | Dinner')
        expect(ledger.size).toBe(0)
      }
      await post(message(833, '@Wanda expense EUR 60 | Museum'))
      await post(message(834, '@Wanda expense USD 42 | Train'))
      const ambiguous = await (await post(message(835, '@Wanda expense $84.50 | Dinner'))).json()
      expect(ambiguous.reply).toContain('Include the currency code')
      expect(ledger.size).toBe(2)
      const exact = await (await post(message(836, '@Wanda expense USD 84.50 | Dinner'))).json()
      expect(exact.reply).toBe('Logged $84.50 for Dinner.')
      expect(ledger.get(exact.expenseId)).toMatchObject({
        title: 'Dinner', currency: 'USD', minor: 8450, paidBy: idFor(config.testers[0]),
        splitAmong: config.testers.map(idFor),
      })
    })
  })
  it('updates one preference/card live, separates currencies and unknown testers, and clears only the sender after restart', async () => {
    await fixture(async ({ post, doc, serverDoc, restart, requests }) => {
      const first = command()
      await post(first); await until(() => pref(doc)?.minor === 60000)
      await post(asTester(message(801, '@Wanda budget EUR 450.25 per person'), 1))
      await post(message(802, '@Wanda budget USD 700.10 per person'))
      const summary = await (await post(message(803, '@Wanda budget summary'))).json()
      expect(summary.reply).toContain('Your budget is USD 700.10 per person.')
      expect(summary.reply).not.toContain('Bob:')
      expect(summary.reply).toContain('Waiting on 1 other.')
      expect(summary.reply).not.toContain('Range:')
      expect(featureCards(serverDoc(), 'preferences')).toHaveLength(1)
      expect(serverDoc().getMap('meta').get('budget')).toBe(0)
      expect(serverDoc().getMap('expenses').size).toBe(0)
      await until(() => state(serverDoc(), 803) === 'sent')
      await restart()
      expect((await (await post(first)).json()).duplicate).toBe(true)
      expect(pref(serverDoc()).minor).toBe(70010)
      await post(message(804, '@Wanda budget clear'))
      expect(pref(serverDoc())).toBeUndefined()
      expect(pref(serverDoc(), 1)).toMatchObject({ currency: 'EUR', minor: 45025 })
      await until(() => state(serverDoc(), 804) === 'sent')
      expect(requests).toHaveLength(5)
    })
  })
  it('reads browser preference/name/position changes while preserving the legacy agreed budget and map', async () => {
    await fixture(async ({ post, doc, serverDoc, restart }) => {
      await post(command()); await until(() => featureCards(doc, 'preferences').length === 1)
      const w = featureCards(doc, 'preferences')[0]
      doc.getMap('widgets').set(w.id, { ...w, x: 1200, y: 1300, w: 480 })
      doc.getMap('budgetPreferences').set(idFor(config.testers[1]), { currency: 'JPY', minor: 1234 })
      await until(() => pref(serverDoc(), 1)?.minor === 1234)
      expect((await (await post(message(810, '@Wanda budget summary'))).json()).reply).toContain('Your budget is USD 600.00')
      await post(message(811, '@Wanda budget USD 0 per person'))
      expect(pref(serverDoc()).minor).toBe(0)
      expect(serverDoc().getMap('widgets').get(w.id)).toMatchObject({ x: 1200, y: 1300, w: 480 })
      expect(serverDoc().getMap('widgets').get('legacy-budget')).toMatchObject({ type: 'budget', x: 100, y: 100 })
      expect(serverDoc().getMap('widgets').get('legacy-map')).toMatchObject({ place: 'Lisbon' })
      expect(serverDoc().getMap('meta').get('budget')).toBe(2000)
      await restart(); await post(message(812, '@Wanda budget summary'))
      expect(featureCards(serverDoc(), 'preferences')).toHaveLength(1)
    }, undefined, {}, (doc) => {
      doc.getMap('meta').set('budget', 2000)
      doc.getMap('widgets').set('legacy-budget', { id: 'legacy-budget', type: 'budget', x: 100, y: 100, z: 3 })
      doc.getMap('widgets').set('legacy-map', { id: 'legacy-map', type: 'map', place: 'Lisbon', x: 600, y: 100, z: 4, h: 360 })
    })
  })
  it('keeps invalid submissions out of preferences and uses only the configured pilot roster', async () => {
    await fixture(async ({ post, serverDoc }) => {
      const invalid = await (await post(message(820, '@Wanda budget USD 1.001 per person'))).json()
      expect(invalid.reply).toContain('2 decimal places')
      expect(serverDoc().getMap('budgetPreferences').size).toBe(0)
      serverDoc().getMap('members').set('guest', { id: 'guest', name: 'Guest' })
      const reply = await (await post(message(821, '@Wanda budget summary'))).json()
      expect(reply.reply).not.toContain('Guest')
      expect(reply.reply).toContain('Waiting on 2 others.')
    })
  })
})

describe('saved places and confirmed pins', () => {
  it('persists the pending selection, checks ownership, confirms after restart, and deduplicates the pin', async () => {
    await fixture(async ({ post, doc, serverDoc, restart, lookups }) => {
      const pending = await lookupPlace(post, serverDoc)
      expect(serverDoc().getMap('savedPlaces').size).toBe(0)
      await until(() => doc.getMap('pendingPlaces').get(pending.id)?.status === 'awaiting_confirmation')
      const wrong = await (await post(asTester(message(901, `@Wanda confirm place ${pending.id} 1`), 1))).json()
      expect(wrong.reply).toContain('Only the tester')
      expect(serverDoc().getMap('placeLocations').size).toBe(0)
      await restart()
      const saved = await (await post(message(902, `Wanda confirm place ${pending.id} 1`))).json()
      expect(serverDoc().getMap('placeLocations').get(saved.placeId)).toMatchObject({ lat: 47.61, lon: -122.34, confirmedBy: idFor(config.testers[0]) })
      expect((await (await post(message(902, `Wanda confirm place ${pending.id} 1`))).json()).duplicate).toBe(true)
      const next = await lookupPlace(post, serverDoc, 903)
      await post(message(904, `@Wanda confirm place ${next.id} 1`))
      expect(serverDoc().getMap('savedPlaces').size).toBe(1)
      expect(featureCards(serverDoc(), 'saved-places')).toHaveLength(1)
      expect(lookups).toHaveLength(1) // persistent cache reused after relay restart
      expect(lookups[0].redirect).toBe('error')
      expect(lookups[0].headers).not.toHaveProperty('Authorization')
      await post(message(905, '@Wanda remove place Pike Place Market, Seattle'))
      expect(serverDoc().getMap('savedPlaces').size).toBe(0)
    })
  })
  it('presents ambiguous candidates without guessing and preserves distinct similarly named locations', async () => {
    await fixture(async ({ post, serverDoc }) => {
      const pending = await lookupPlace(post, serverDoc)
      expect(pending.candidates).toHaveLength(2)
      const choose = await (await post(message(910, `@Wanda confirm place ${pending.id}`))).json()
      expect(choose.reply).toContain('2. Market — Seattle')
      expect(choose.reply).not.toContain(pending.id)
      expect(choose.reply).not.toContain('-122.')
      expect(serverDoc().getMap('savedPlaces').size).toBe(0)
      await post(message(911, `@Wanda confirm place ${pending.id} 1`))
      const next = await lookupPlace(post, serverDoc, 912)
      await post(message(913, `@Wanda confirm place ${next.id} 2`))
      const places = serverDoc().getMap('savedPlaces'), ids = [...places.keys()]
      expect(places.size).toBe(2)
      for (const id of ids) serverDoc().getMap('savedPlaceLabels').set(id, 'Market')
      expect((await (await post(message(914, '@Wanda remove place Market'))).json()).reply).toContain('Several places match')
      expect(places.size).toBe(2)
      await post(message(915, `@Wanda remove place ${ids[1]}`))
      expect(places.has(ids[0])).toBe(true)
      expect(places.has(ids[1])).toBe(false)
    }, undefined, {}, undefined, async () => geoResult([feature('Market', -122.34, 47.61, 1), feature('Market', -122.4, 47.7, 2)]))
  })
  it('saves unresolved map links accurately, never follows redirects, and stages a requester-confirmed location', async () => {
    await fixture(async ({ post, doc, serverDoc, lookups, restart }) => {
      const event = message(920, '@Wanda place https://maps.app.goo.gl/sample')
      const saved = await (await post(event)).json()
      expect(saved.reply).toContain('Location unknown')
      expect(serverDoc().getMap('placeLocations').size).toBe(0)
      expect(lookups).toHaveLength(0)
      await until(() => doc.getMap('savedPlaces').has(saved.placeId))
      doc.getMap('savedPlaceLabels').set(saved.placeId, 'Our market')
      await until(() => serverDoc().getMap('savedPlaceLabels').get(saved.placeId) === 'Our market')
      const pending = await (await post(message(921, `@Wanda locate place ${saved.placeId} | 47.60,-122.34`))).json()
      expect(serverDoc().getMap('placeLocations').size).toBe(0)
      await post(message(922, `@Wanda confirm place ${pending.pendingId} 1`))
      expect(serverDoc().getMap('savedPlaceLabels').get(saved.placeId)).toBe('Our market')
      expect((await (await post(message(923, '@Wanda place https://maps.app.goo.gl/sample'))).json()).reply).toContain('saved location')
      expect(serverDoc().getMap('savedPlaces').size).toBe(1)
      expect([...serverDoc().getMap('widgets').values()].filter((w) => w.type === 'note')).toHaveLength(0)
      await restart(); expect((await (await post(event)).json()).duplicate).toBe(true)
      expect(serverDoc().getMap('placeLocations').size).toBe(1)
    })
  })
  it('keeps coordinate URLs pending until confirmed and rejects expiry and invalid coordinates', async () => {
    await fixture(async ({ post, serverDoc, restart, lookups }) => {
      const pending = await (await post(message(930, '@Wanda place https://www.google.com/maps/search/?api=1&query=47.6,-122.34'))).json()
      expect(serverDoc().getMap('placeLocations').size).toBe(0)
      const map = serverDoc().getMap('pendingPlaces'), p = map.get(pending.pendingId)
      map.set(p.id, { ...p, candidates: [{ ...p.candidates[0], lat: 99 }] })
      expect((await (await post(message(933, `@Wanda confirm place ${p.id} 1`))).json()).reply).toContain('invalid coordinates')
      expect(serverDoc().getMap('placeLocations').size).toBe(0)
      map.set(p.id, { ...p, expiresAt: Date.now() - 1 })
      await restart()
      expect((await (await post(message(931, `@Wanda confirm place ${p.id} 1`))).json()).reply).toContain('expired')
      expect((await (await post(message(932, '@Wanda place https://www.google.com/maps/search/?api=1&query=95,0'))).json()).reply).toContain('invalid')
      expect(lookups).toHaveLength(0)
    })
  })
  it.each([
    ['offline', () => { throw Error('sample failure') }],
    ['provider refusal', () => Response.json({}, { status: 429 })],
    ['invalid results', () => Response.json({ features: null })],
    ['oversized response', () => new Response('x'.repeat(70000))],
  ])('keeps unresolved work pending without pins when geocoding is %s', async (_name, response) => {
    await fixture(async ({ post, serverDoc, restart, requests }) => {
      const pending = await lookupPlace(post, serverDoc)
      expect(pending.status).toBe('unresolved')
      expect(serverDoc().getMap('savedPlaces').size).toBe(0)
      const count = requests.length
      await restart(); await post(message(900, '@Wanda place Pike Place Market, Seattle'))
      expect(requests).toHaveLength(count)
    }, undefined, {}, undefined, response)
  })

  it('enforces the persisted daily lookup cap and never sends provider credentials to the geocoder', async () => {
    await fixture(async ({ post, serverDoc, lookups }) => {
      await lookupPlace(post, serverDoc)
      const limited = await lookupPlace(post, serverDoc, 980, '@Wanda place Another market, Seattle')
      expect(limited.reason).toBe('geocoder_daily_limit')
      expect(lookups).toHaveLength(1)
      expect(lookups[0].headers['User-Agent']).toContain('WanderPilot')
      expect(serverDoc().getMap('pilotGeocoderMeta').get('count')).toBe(1)
    }, undefined, { geocoderDailyLimit: 1 })
  })
  it('keeps lookups disabled until opted in, while retaining unresolved pending records', async () => {
    await fixture(async ({ post, serverDoc, lookups }) => {
      const pending = await lookupPlace(post, serverDoc)
      expect(pending.status).toBe('unresolved')
      expect(pending.reason).toBe('geocoder_disabled')
      expect(lookups).toHaveLength(0)
    }, undefined, { geocoderEnabled: false })
  })

  it('deduplicates in-flight requests and safely resumes an interrupted read-only lookup after restart', async () => {
    let attempts = 0
    await fixture(async ({ post, serverDoc, restart, lookups }) => {
      const first = await (await post(message(940, '@Wanda place Pike Place Market, Seattle'))).json()
      await until(() => lookups.length === 1)
      expect((await (await post(message(941, '@Wanda place pike place market, seattle'))).json()).reply).toContain('still being looked up')
      expect(serverDoc().getMap('pendingPlaces').size).toBe(1)
      await restart()
      await until(() => state(serverDoc(), 940, 'pilotPlaceDeliveries') === 'sent')
      expect(serverDoc().getMap('pendingPlaces').get(first.pendingId).status).toBe('awaiting_confirmation')
      expect(lookups).toHaveLength(2)
    }, undefined, {}, undefined, () => ++attempts === 1 ? new Promise(() => {}) : geoResult())
  })
})

describe('feature security, replay and shared edits', () => {
  it('rejects unauthorized/signature/outbound events without preferences or places', async () => {
    await fixture(async ({ post, serverDoc, lookups, requests }) => {
      for (const event of [command(), message(950, '@Wanda place https://maps.app.goo.gl/test')]) {
        expect((await post(event, true)).status).toBe(401)
        for (const patch of [{ chat_id: 'iMessage;+;other' }, { handle: '+12025550199' }]) expect((await post({ ...event, message: { ...event.message, ...patch } })).status).toBe(403)
        expect((await (await post({ ...event, event: 'message.sent' })).json()).ignored).toBeTruthy()
      }
      expect(serverDoc().getMap('budgetPreferences').size).toBe(0)
      expect(serverDoc().getMap('savedPlaces').size).toBe(0)
      expect(lookups).toHaveLength(0); expect(requests).toHaveLength(0)
    })
  })
  it.each([['budget', '@Wanda budget USD 600 per person', 'pilotBudgetDeliveries'], ['place', '@Wanda place https://maps.app.goo.gl/test', 'pilotPlaceDeliveries']])('never repeats a %s reply after uncertain send or restart', async (_feature, text, map) => {
    await fixture(async ({ post, serverDoc, restart, requests }) => {
      const event = message(960, text)
      await post(event); await until(() => state(serverDoc(), 960, map) === 'uncertain')
      await restart(); await post(event)
      expect(requests).toHaveLength(1)
      expect(state(serverDoc(), 960, map)).toBe('uncertain')
    }, () => { throw Error('sample send timeout') })
  })

  it('persists a send claim and resumes only unclaimed replies after restart', async () => {
    let calls = 0
    await fixture(async ({ post, serverDoc, restart, requests }) => {
      await post(command()); await until(() => requests.length === 1)
      await post(message(990, '@Wanda budget USD 800 per person'))
      expect(state(serverDoc(), 990)).toBe('pending')
      await restart(); await until(() => state(serverDoc(), 990) === 'sent')
      expect(state(serverDoc())).toBe('uncertain')
      await post(command())
      expect(pref(serverDoc()).minor).toBe(80000)
      expect(requests).toHaveLength(2)
    }, () => ++calls === 1 ? new Promise(() => {}) : accepted())
  })
  it('sends no reply when saving ingress fails, then safely persists and sends on replay', async () => {
    await fixture(async ({ post, serverDoc, requests, restart }) => {
      const rename = fs.renameSync; let writes = 0
      const spy = vi.spyOn(fs, 'renameSync').mockImplementation((...args) => { if (++writes === 1) throw Error('sample persistence failure'); return rename(...args) })
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      try { expect((await post(command())).status).toBe(503) } finally { spy.mockRestore(); log.mockRestore() }
      expect(requests).toHaveLength(0)
      await post(command()); await until(() => state(serverDoc()) === 'sent')
      await restart(); await post(command())
      expect(pref(serverDoc()).minor).toBe(60000)
      expect(requests).toHaveLength(1)
    })
  })

  it('keeps disabled commands from becoming unrelated link notes', async () => {
    await fixture(async ({ post, serverDoc, requests }) => {
      for (const text of ['@Wanda budget USD 600 per person', '@Wanda place https://maps.app.goo.gl/test']) expect((await (await post(message(970, text))).json()).ignored).toBeTruthy()
      expect(serverDoc().getMap('widgets').size).toBe(1)
      expect(requests).toHaveLength(0)
    }, undefined, { budgets: false, places: false })
  })
  it('merges independent browser labels/preferences and confirmation/deletion changes', () => {
    const relay = new Y.Doc(), browser = new Y.Doc(), saved = { id: 'sp_one', label: 'Original', dedupeKey: 'one', source: { senderId: 'alice', name: 'Alice' } }
    relay.getMap('savedPlaces').set('sp_one', saved)
    Y.applyUpdate(browser, Y.encodeStateAsUpdate(relay))
    relay.getMap('placeLocations').set('sp_one', { lat: 47, lon: -122 })
    relay.getMap('budgetPreferences').set('alice', { currency: 'USD', minor: 60000 })
    browser.getMap('savedPlaceLabels').set('sp_one', 'Browser edit')
    browser.getMap('budgetPreferences').set('bob', { currency: 'EUR', minor: 45000 })
    const a = Y.encodeStateAsUpdate(relay), b = Y.encodeStateAsUpdate(browser)
    Y.applyUpdate(relay, b); Y.applyUpdate(browser, a)
    expect(relay.getMap('savedPlaceLabels').get('sp_one')).toBe('Browser edit')
    expect(relay.getMap('placeLocations').get('sp_one').lat).toBe(47)
    expect(relay.getMap('budgetPreferences').size).toBe(2)
    const roster = { alice: { name: 'Alice' }, bob: { name: 'Bob' }, cara: { name: 'Cara' } }
    expect(budgetSummary(roster, relay.getMap('budgetPreferences').toJSON())).toContain('Waiting on 1 other.')
    relay.getMap('placeLocations').set('sp_one', { lat: 48, lon: -123 })
    browser.getMap('savedPlaces').delete('sp_one')
    browser.getMap('placeLocations').delete('sp_one')
    Y.applyUpdate(relay, Y.encodeStateAsUpdate(browser))
    expect(relay.getMap('savedPlaces').has('sp_one')).toBe(false)
    relay.destroy(); browser.destroy()
  })
})

describe('short reply-bound choices and durable map command fragments', () => {
  it('binds real reply_to IDs/GUIDs to saved outbound choices across restart, checks owner, ignores ordinary numbers', async () => {
    let sendId = 40000
    await fixture(async ({ post, serverDoc, restart, requests }) => {
      const pending = await lookupPlace(post, serverDoc, 1100)
      const choiceJob = serverDoc().getMap('pilotPlaceDeliveries').get('zerosettle.message.received.1100')
      expect(choiceJob.reply).toContain('1. Pike Place Market — Seattle')
      expect(choiceJob.reply).not.toContain(pending.id)
      expect(choiceJob.reply).not.toContain('47.61')
      expect(choiceJob.reply).not.toContain('United States')
      const reply = (id, who = 0, target = { id: choiceJob.providerMessageId }) => ({ ...asTester(message(id, '1'), who), message: { ...asTester(message(id, '1'), who).message, reply_to: target } })
      await post(message(1101, '1'))
      expect(serverDoc().getMap('savedPlaces').size).toBe(0)
      const wrong = await (await post(reply(1102, 1))).json()
      expect(wrong.reply).toContain('Only the tester')
      await restart()
      const event = reply(1103, 0, { guid: choiceJob.providerGuid })
      const saved = await (await post(event)).json()
      expect(saved.reply).toBe('Added Pike Place Market to the map.')
      expect(serverDoc().getMap('savedPlaces').get(saved.placeId).label).toBe('Pike Place Market')
      expect(serverDoc().getMap('placeLocations').get(saved.placeId)).toMatchObject({ lat: 47.61, lon: -122.34 })
      await until(() => state(serverDoc(), 1103, 'pilotPlaceDeliveries') === 'sent')
      const count = requests.length
      await restart(); expect((await (await post(event)).json()).duplicate).toBe(true)
      expect(requests).toHaveLength(count)
      expect(serverDoc().getMap('savedPlaces').size).toBe(1)
    }, async () => { const id = ++sendId; return Response.json({ ok: true, status: 'message_sent', id, record: { guid: `sample-guid-${id}` } }) })
  })
  it('supports singleton @Wanda choose, asks for a direct reply when several lookups are active, and enforces expiry', async () => {
    await fixture(async ({ post, serverDoc }) => {
      const first = await lookupPlace(post, serverDoc, 1120)
      const second = await lookupPlace(post, serverDoc, 1121, '@Wanda place Another Market, Seattle')
      expect((await (await post(message(1122, 'Wanda CHOOSE 1'))).json()).reply).toContain('reply directly')
      const pending = serverDoc().getMap('pendingPlaces')
      pending.set(first.id, { ...first, expiresAt: Date.now() - 1 })
      const result = await (await post(message(1123, '@Wanda choose 1'))).json()
      expect(result.reply).toBe('Added Pike Place Market to the map.')
      expect(pending.get(second.id).status).toBe('confirmed')
      expect((await (await post(message(1124, '@Wanda choose 1'))).json()).reply).toContain('No active')
    })
  })
  it.each(['command-first', 'link-first'])('consumes split map URLs %s through restart without creating notes or repeating sends', async (order) => {
    await fixture(async ({ post, serverDoc, restart, requests }) => {
      const ts = Date.now()
      const command = { ...message(1140, 'Wanda place'), message: { ...message(1140, 'Wanda place').message, ts_ms: ts } }
      // Real provider evidence: IDs are not consecutive because our reply can occupy an intervening ID.
      const link = { ...message(1143, 'https://maps.app.goo.gl/market'), message: { ...message(1143, 'https://maps.app.goo.gl/market').message, ts_ms: ts + 5599 } }
      const [a, b] = order === 'command-first' ? [command, link] : [link, command]
      await post(a)
      await restart()
      const saved = await (await post(b)).json()
      expect(saved.reply).toContain('Saved map link. Location unknown.')
      expect(serverDoc().getMap('savedPlaces').size).toBe(1)
      expect([...serverDoc().getMap('widgets').values()].filter((w) => w.type === 'note')).toHaveLength(0)
      await until(() => state(serverDoc(), b.message.id, 'pilotPlaceDeliveries') === 'sent')
      const count = requests.length
      await restart()
      expect((await (await post(a)).json()).duplicate).toBe(true)
      expect((await (await post(b)).json()).duplicate).toBe(true)
      expect(requests).toHaveLength(count)
      expect(serverDoc().getMap('savedPlaces').size).toBe(1)
    })
  })
  it('does not correlate across unrelated inbound conversation, groups, owners, or the timestamp bound; supports a direct map-link reply', async () => {
    await fixture(async ({ post, serverDoc }) => {
      const ts = Date.now(), withTime = (id, text, offset = 0) => ({ ...message(id, text), message: { ...message(id, text).message, ts_ms: ts + offset } })
      await post(withTime(1160, '@Wanda place'))
      await post(withTime(1161, 'Some unrelated conversation', 1000))
      const link = withTime(1163, 'https://maps.app.goo.gl/other', 5000)
      expect((await (await post(link)).json()).deferred).toBeTruthy()
      expect(serverDoc().getMap('savedPlaces').size).toBe(0)
      const direct = { ...withTime(1164, 'https://maps.app.goo.gl/target', 10000), message: { ...withTime(1164, 'https://maps.app.goo.gl/target', 10000).message, reply_to: { id: 1160 } } }
      expect((await (await post(direct)).json()).reply).toContain('Saved map link')
      expect(serverDoc().getMap('savedPlaces').size).toBe(1)
    })
  })
  it('compacts only original pilot defaults on load and preserves custom sizes, positions and legacy expense cards', async () => {
    await fixture(async ({ serverDoc }) => {
      const widgets = serverDoc().getMap('widgets')
      expect(widgets.get('old-budget')).toMatchObject({ purpose: 'preferences', h: 336, x: 12, y: 24 })
      expect(widgets.get('proven-pilot')).toMatchObject({ purpose: 'preferences', h: 336 })
      expect(widgets.get('custom-map')).toMatchObject({ h: 620, w: 480, x: 1000 })
      expect(widgets.get('marked-budget')).toMatchObject({ h: 600, userResized: true })
      expect(widgets.get('expense')).toMatchObject({ h: 600 })
    }, undefined, {}, (doc) => {
      doc.getMap('pilotMessageReceipts').set('old-command', { command: 'wanda-budget', outcome: { widgetId: 'proven-pilot' } })
      for (const w of [
        { id: 'proven-pilot', type: 'budget', h: 600 },
        { id: 'old-budget', type: 'budget', purpose: 'preferences', h: 600, x: 12, y: 24 },
        { id: 'custom-map', type: 'map', purpose: 'saved-places', h: 620, w: 480, x: 1000 },
        { id: 'marked-budget', type: 'budget', purpose: 'preferences', h: 600, userResized: true },
        { id: 'expense', type: 'budget', h: 600 },
      ]) doc.getMap('widgets').set(w.id, { z: 3, ...w })
    })
  })
})

it.each(['comment-first', 'link-first'])('preserves ordinary map-link capture and its split comment when no map command arrives (%s)', async (order) => {
  await fixture(async ({ post, serverDoc, restart }) => {
    const ts = Date.now()
    const comment = { ...message(1200, 'A great stop for our trip'), message: { ...message(1200, 'A great stop for our trip').message, ts_ms: ts } }
    const link = { ...message(1201, 'https://maps.app.goo.gl/ordinary'), message: { ...message(1201, 'https://maps.app.goo.gl/ordinary').message, ts_ms: ts + 5000 } }
    const [a, b] = order === 'comment-first' ? [comment, link] : [link, comment]
    await post(a); await post(b)
    expect(serverDoc().getMap('savedPlaces').size).toBe(0)
    const fragments = serverDoc().getMap('pilotMapLinkFragments'), f = fragments.get('zerosettle.message.received.1201')
    expect(f.comment).toBe('A great stop for our trip')
    fragments.set(f.messageId, { ...f, expiresAt: Date.now() - 1 })
    await restart()
    await until(() => [...serverDoc().getMap('widgets').values()].some((w) => w.type === 'note'))
    const note = [...serverDoc().getMap('widgets').values()].find((w) => w.type === 'note')
    expect(note.text).toBe('https://maps.app.goo.gl/ordinary\n\nA great stop for our trip')
    expect(note.source.commentMessageId).toBe('zerosettle.message.received.1200')
    expect((await (await post(link)).json()).duplicate).toBe(true)
    expect([...serverDoc().getMap('widgets').values()].filter((w) => w.type === 'note')).toHaveLength(1)
  })
})

it('selects the referenced lookup among several and refuses expired or unrelated reply targets', async () => {
  let id = 60000
  await fixture(async ({ post, serverDoc, restart }) => {
    const a = await lookupPlace(post, serverDoc, 1300)
    const b = await lookupPlace(post, serverDoc, 1301, '@Wanda place A different place, Seattle')
    const job = serverDoc().getMap('pilotPlaceDeliveries').get('zerosettle.message.received.1300')
    const reply = (id, target) => ({ ...message(id, '1'), message: { ...message(id, '1').message, reply_to: target } })
    await post(reply(1302, { id: 999999, text: job.reply }))
    expect(serverDoc().getMap('savedPlaces').size).toBe(0)
    await restart()
    await post(reply(1303, { id: job.providerMessageId }))
    const pending = serverDoc().getMap('pendingPlaces')
    expect(pending.get(a.id).status).toBe('confirmed')
    expect(pending.get(b.id).status).toBe('awaiting_confirmation')
    const jobB = serverDoc().getMap('pilotPlaceDeliveries').get('zerosettle.message.received.1301')
    pending.set(b.id, { ...pending.get(b.id), expiresAt: Date.now() - 1 })
    expect((await (await post(reply(1304, { id: jobB.providerMessageId }))).json()).reply).toContain('expired')
    expect(serverDoc().getMap('savedPlaces').size).toBe(1)
  }, async () => Response.json({ ok: true, status: 'message_sent', id: ++id }))
})

it('keeps split map fragments separated by sender, group, and the six-second provider-time window', async () => {
  await fixture(async ({ post, serverDoc }) => {
    const ts = Date.now(), timed = (id, text, delta) => ({ ...message(id, text), message: { ...message(id, text).message, ts_ms: ts + delta } })
    await post(timed(1400, '@Wanda place', 0))
    expect((await post({ ...timed(1401, 'https://maps.app.goo.gl/wrong-group', 5000), message: { ...timed(1401, 'https://maps.app.goo.gl/wrong-group', 5000).message, chat_id: 'iMessage;+;chatOther' } })).status).toBe(403)
    expect((await (await post(asTester(timed(1402, 'https://maps.app.goo.gl/bob', 5000), 1))).json()).deferred).toBeTruthy()
    expect((await (await post(timed(1403, 'https://maps.app.goo.gl/too-late', 6001))).json()).deferred).toBeTruthy()
    expect(serverDoc().getMap('savedPlaces').size).toBe(0)
    expect([...serverDoc().getMap('widgets').values()].filter((w) => w.type === 'note')).toHaveLength(0)
    expect(serverDoc().getMap('pilotMapLinkFragments').size).toBe(3)
  })
})
