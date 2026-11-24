// Isolated Chromium + signed checklist actions + actual relay restart. All replies are mocked.
import crypto from 'node:crypto'
import { seedPilotTrip } from '../server/pilot-fixture.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { chromium } from 'playwright'
import { zeroSettleSenderId } from '../server/zerosettle-protocol.mjs'
import { sampleEvent, signSample } from '../server/zerosettle-sample.mjs'
const port = Number(process.env.PILOT_PORT ?? 1252), base = `http://127.0.0.1:${port}`
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-planning-browser-'))
// Start with actual persisted pilot schemas, before the normal browser/WebSocket joins.
const persisted = new Y.Doc(); seedPilotTrip(persisted)
persisted.getMap('budgetPreferences').set(zeroSettleSenderId(sampleEvent('alice').message.handle), { currency: 'USD', minor: 50025 })
persisted.getMap('widgets').set('w_budget_preferences', { id: 'w_budget_preferences', type: 'budget', purpose: 'preferences', x: 576, y: 128, z: 2, h: 600 })
persisted.getMap('widgets').set('w_saved_places', { id: 'w_saved_places', type: 'map', purpose: 'saved-places', place: '', x: 972, y: 128, z: 3, h: 620 })
persisted.getMap('savedPlaces').set('sp_existing', { id: 'sp_existing', label: 'Existing market, Seattle, United States', dedupeKey: 'legacy', createdAt: 1, source: { senderId: zeroSettleSenderId(sampleEvent('alice').message.handle), name: 'Alice' } })
persisted.getMap('placeLocations').set('sp_existing', { lat: 47.6, lon: -122.3, provider: 'photon' })
fs.writeFileSync(path.join(dataDir, crypto.createHash('sha256').update('wander-pilot-lisbon-demo').digest('hex').slice(0, 32) + '.ydoc'), Y.encodeStateAsUpdate(persisted)); persisted.destroy()
let relay, browser, provider
const observer = new Y.Doc(), sends = []
const until = async (fn) => { const end = Date.now() + 6000; while (!fn()) { if (Date.now() > end) throw Error('Sync timed out'); await new Promise((r) => setTimeout(r, 20)) } }
async function start() {
  relay = spawn(process.execPath, ['server/pilot-demo.mjs'], { env: { ...process.env, PILOT_PORT: String(port), PILOT_DATA_DIR: dataDir,
    PILOT_ZEROSETTLE_POLL_SAMPLES: '0', PILOT_ZEROSETTLE_LIST_SAMPLES: '0', PILOT_ZEROSETTLE_PLANNING_SAMPLES: '1', PILOT_ZEROSETTLE_LINK_SAMPLES: '0', TWILIO_CONVERSATIONS_ENABLED: '0', TWILIO_SMS_ENABLED: '0', LOCAL_TEST_MESSAGES: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Readiness timed out')), 10000)
    relay.once('error', reject); relay.once('exit', (code) => { clearTimeout(timeout); reject(Error(`Relay exited ${code}`)) })
    let buffered = ''
    relay.stdout.on('data', (chunk) => {
      buffered += chunk.toString(); const lines = buffered.split('\n'); buffered = lines.pop()
      for (const line of lines) if (line.startsWith('SAMPLE_ZEROSETTLE_PLANNING_REPLY ')) sends.push(JSON.parse(line.slice('SAMPLE_ZEROSETTLE_PLANNING_REPLY '.length)))
      if (chunk.toString().includes('Pilot ready:')) { clearTimeout(timeout); resolve() }
    })
    relay.stderr.on('data', (chunk) => process.stderr.write(chunk))
  })
}
async function stop() { if (relay && relay.exitCode === null) { const exited = once(relay, 'exit'); relay.kill('SIGTERM'); await exited } }
async function post(payload, invalid = false) {
  const raw = JSON.stringify(payload)
  const res = await fetch(base + '/webhooks/zerosettle', { method: 'POST', headers: { 'content-type': 'application/json', 'x-zerosettle-signature': invalid ? 'invalid' : signSample(raw) }, body: raw })
  assert.equal(res.status, invalid ? 401 : 200)
  return res.json()
}
try {
  await start()
  provider = new WebsocketProvider(base.replace('http:', 'ws:') + '/sync', 'wander-pilot-lisbon-demo', observer, { WebSocketPolyfill: WebSocket, disableBc: true })
  await new Promise((resolve) => provider.once('synced', resolve))
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], sockets = []
  page.on('pageerror', (err) => errors.push(err.message)); page.on('websocket', (ws) => sockets.push(ws.url()))
  await page.route('https://maps.google.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Mock map frame</p>' }))
  await page.goto(base + '/t/pilot-lisbon-demo')
  await page.getByRole('textbox', { name: 'your name', exact: true }).fill('Planning observer')
  await page.getByRole('button', { name: 'continue as guest', exact: true }).click()
  await page.getByLabel('live', { exact: true }).waitFor()
  let navigations = 0; page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++ })
  const event = (id, text, who = 'alice') => ({ ...sampleEvent(who), message: { ...sampleEvent(who).message, id, text } })
  const budgetFirst = event(90001, 'Wanda budget USD 600 per person')
  const aliceId = zeroSettleSenderId(sampleEvent('alice').message.handle), bobId = zeroSettleSenderId(sampleEvent('bob').message.handle)
  const budget = page.locator('[data-budget-preferences]'), places = page.locator('[data-saved-places]')
  const visible = async (locator) => { await locator.scrollIntoViewIfNeeded(); assert.equal(await locator.isVisible(), true); const box = await locator.boundingBox(); assert.ok(box && box.width > 30 && box.height > 10)
    const unclipped = await locator.evaluate((el) => {
      const box = el.getBoundingClientRect(); let left = Math.max(0, box.left), top = Math.max(0, box.top), right = Math.min(innerWidth, box.right), bottom = Math.min(innerHeight, box.bottom)
      for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p), r = p.getBoundingClientRect(); if (s.overflowX !== 'visible') { left = Math.max(left, r.left); right = Math.min(right, r.right) } if (s.overflowY !== 'visible') { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom) } }
      return Math.max(0, right - left) * Math.max(0, bottom - top) / (box.width * box.height)
    })
    assert.ok(unclipped > 0.8, `Visible content clipped: ${await locator.innerText()}`)
  }
  await visible(budget.getByText('Trip budget', { exact: true }))
  await visible(budget.getByText('Alice:', { exact: false }).first())
  assert.ok((await budget.innerText()).includes('USD 500.25'))
  assert.ok(!(await budget.innerText()).includes('spent so far'))
  assert.equal((await page.locator('#widget-w_budget_preferences').boundingBox()).height, 336)
  assert.equal((await page.locator('#widget-w_saved_places').boundingBox()).height, 456)
  await visible(places.getByLabel('place label sp_existing', { exact: true }))
  assert.equal(await places.getByLabel('place label sp_existing', { exact: true }).inputValue(), 'Existing market, Seattle, United States')
  await places.frameLocator('iframe').getByText('Mock map frame', { exact: true }).waitFor()
  assert.ok((await places.locator('iframe').getAttribute('src')).includes('47.6%2C-122.3'))
  await places.getByLabel('remove saved place sp_existing', { exact: true }).click()
  await until(() => !observer.getMap('savedPlaces').has('sp_existing'))
  await post(budgetFirst)
  await budget.getByRole('list', { name: 'Planned budgets' }).getByText('Alice', { exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('[data-budget-preferences]')?.textContent.includes('USD 600.00'))
  await post(event(90002, '@Wanda budget EUR 450.25 per person', 'bob'))
  await page.waitForFunction(() => document.querySelector('[data-budget-preferences]')?.textContent.includes('EUR 450.25'))
  assert.ok((await budget.innerText()).includes('Cara: Waiting for a response'))
  await budget.getByLabel('Participant', { exact: true }).selectOption(bobId)
  await budget.getByRole('button', { name: 'Edit my budget', exact: true }).click()
  await page.getByLabel('Currency', { exact: true }).selectOption('JPY')
  await page.getByLabel('Amount', { exact: true }).fill('1234')
  await page.getByRole('button', { name: 'Save budget', exact: true }).click()
  await until(() => observer.getMap('budgetPreferences').get(bobId)?.minor === 1234)
  const summary = await post(event(90003, '@Wanda budget summary'))
  assert.ok(summary.reply.includes('Your budget is USD 600.00 per person. Waiting on 1 other.'))
  assert.equal(observer.getMap('budgetPreferences').get(bobId).currency, 'JPY')
  await post(event(90004, '@Wanda budget USD 700.10 per person'))
  await until(() => observer.getMap('budgetPreferences').get(aliceId)?.minor === 70010)
  await page.waitForFunction(() => document.querySelector('[data-budget-preferences]')?.innerText.includes('USD 700.10'))
  await visible(budget.getByText('Alice: USD 700.10', { exact: false }).first())
  assert.equal(await budget.count(), 1)
  const linkEvent = event(90005, '@Wanda place https://maps.app.goo.gl/sample')
  const unresolved = await post(linkEvent)
  assert.ok(unresolved.reply.includes('Location unknown'))
  await places.getByLabel(`place label ${unresolved.placeId}`, { exact: true }).waitFor()
  await places.getByLabel(`place label ${unresolved.placeId}`, { exact: true }).fill('Weekend market link')
  await until(() => observer.getMap('savedPlaceLabels').get(unresolved.placeId) === 'Weekend market link')
  const placeEvent = event(90006, '@Wanda place Pike Place Market, Seattle')
  const pending = await post(placeEvent)
  await until(() => observer.getMap('pendingPlaces').get(pending.pendingId)?.status === 'awaiting_confirmation')
  assert.equal(await places.locator('iframe').count(), 0)
  await until(() => observer.getMap('pilotPlaceDeliveries').get('zerosettle.message.received.90006')?.state === 'sent')
  const choiceJob = observer.getMap('pilotPlaceDeliveries').get('zerosettle.message.received.90006')
  assert.ok(choiceJob.reply.includes('1. Pike Place Market — Seattle'))
  assert.ok(!choiceJob.reply.includes(pending.pendingId)); assert.ok(!choiceJob.reply.includes('-122.'))
  const reply = (id, who = 'alice') => ({ ...event(id, '1', who), message: { ...event(id, '1', who).message, reply_to: { id: choiceJob.providerMessageId } } })
  const unauthorized = await post(reply(90007, 'bob'))
  assert.ok(unauthorized.reply.includes('Only the tester'))
  const confirm = reply(90008)
  const pinned = await post(confirm)
  assert.equal(pinned.reply, 'Added Pike Place Market to the map.')
  await visible(places.getByLabel(`place label ${pinned.placeId}`, { exact: true }))
  assert.equal(await places.getByLabel(`place label ${pinned.placeId}`, { exact: true }).inputValue(), 'Pike Place Market')
  await places.frameLocator('iframe').getByText('Mock map frame', { exact: true }).waitFor()
  assert.ok((await places.locator('iframe').getAttribute('src')).includes('47.609%2C-122.342'))
  await visible(places.getByRole('status').filter({ hasText: /Map preview.*Open location above/ }))
  await visible(places.getByRole('link', { name: 'Open location', exact: true }))
  await page.screenshot({ path: '/tmp/wander-zerosettle-planning-visible.png', fullPage: true })
  await places.getByRole('link', { name: '© OpenStreetMap contributors · ODbL · via Photon', exact: true }).waitFor()
  assert.equal(observer.getMap('savedPlaces').size, 2)
  assert.equal(await page.getByPlaceholder('write something for the crew…').count(), 0)
  await post(event(90009, `@Wanda locate place ${unresolved.placeId} | 47.60,-122.34`))
  const locationConfirm = event(90010, '@Wanda choose 1')
  await post(locationConfirm)
  await until(() => observer.getMap('placeLocations').size === 2)
  assert.equal(await places.getByLabel(`place label ${unresolved.placeId}`, { exact: true }).inputValue(), 'Weekend market link')
  await places.getByLabel(`remove saved place ${pinned.placeId}`, { exact: true }).click()
  await until(() => !observer.getMap('savedPlaces').has(pinned.placeId))
  const listing = await post(event(90011, '@Wanda places'))
  assert.ok(listing.reply.includes('Weekend market link'))
  assert.ok(!listing.reply.includes(pinned.placeId))
  await post(event(90012, '@Wanda budget clear'))
  await until(() => !observer.getMap('budgetPreferences').has(aliceId))
  assert.equal(observer.getMap('budgetPreferences').get(bobId).currency, 'JPY')
  await page.waitForFunction(() => document.querySelector('[data-budget-preferences]')?.innerText.includes('Alice: Waiting for a response'))
  await until(() => sends.length === 12 && [...observer.getMap('pilotBudgetDeliveries').values(), ...observer.getMap('pilotPlaceDeliveries').values()].every((job) => job.state === 'sent'))
  const ts = Date.now()
  const splitCommand = { ...event(90100, 'Wanda place'), message: { ...event(90100, 'Wanda place').message, ts_ms: ts } }
  const splitUrl = { ...event(90103, 'https://maps.app.goo.gl/split'), message: { ...event(90103, 'https://maps.app.goo.gl/split').message, ts_ms: ts + 5500 } }
  await post(splitUrl); await stop(); await start()
  const splitSaved = await post(splitCommand)
  await visible(places.getByLabel(`place label ${splitSaved.placeId}`, { exact: true }))
  await visible(places.getByRole('link', { name: 'Open saved map link', exact: true }).last())
  assert.equal(await page.getByPlaceholder('write something for the crew…').count(), 0)
  await until(() => sends.length === 13 && observer.getMap('pilotPlaceDeliveries').get('zerosettle.message.received.90100')?.state === 'sent')
  // Simulate an explicit external map failure without treating widget existence as success.
  await page.unroute('https://maps.google.com/**')
  await page.route('https://maps.google.com/**', (route) => route.abort())
  const changed = observer.getMap('placeLocations').get(unresolved.placeId)
  observer.getMap('placeLocations').set(unresolved.placeId, { ...changed, lat: 47.62 })
  await page.waitForFunction(() => document.querySelector('[data-saved-places] iframe')?.getAttribute('src')?.includes('47.62%2C'))
  await visible(places.getByRole('status').filter({ hasText: /Map preview.*Open location above/ }))
  await visible(places.getByRole('link', { name: 'Open location', exact: true }))
  await visible(places.getByLabel(`place label ${unresolved.placeId}`, { exact: true }))
  await page.screenshot({ path: '/tmp/wander-zerosettle-planning-verified.png', fullPage: true })
  const budgetCard = page.locator('#widget-w_budget_preferences')
  await budgetCard.scrollIntoViewIfNeeded()
  const handle = await budgetCard.getByLabel('resize widget', { exact: true }).boundingBox()
  await page.mouse.move(handle.x + 8, handle.y + 8); await page.mouse.down(); await page.mouse.move(handle.x + 68, handle.y + 56, { steps: 4 }); await page.mouse.up()
  await until(() => observer.getMap('widgets').get('w_budget_preferences')?.userResized === true)
  const resized = await budgetCard.boundingBox()
  assert.equal(resized.height, 384); assert.equal(resized.width, 420)
  const before = sends.length
  await stop(); await start()
  for (const payload of [budgetFirst, linkEvent, placeEvent, confirm, locationConfirm, splitCommand, splitUrl]) assert.equal((await post(payload)).duplicate, true)
  await page.getByLabel('live', { exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('[data-budget-preferences]')?.innerText.includes('JPY 1234'))
  await visible(budget.getByText('Bob: JPY 1234', { exact: false }).first())
  assert.equal(sends.length, before)
  assert.equal((await budgetCard.boundingBox()).height, resized.height)
  assert.equal((await budgetCard.boundingBox()).width, resized.width)
  assert.equal(await budget.count(), 1); assert.equal(await places.count(), 1)
  assert.equal(observer.getMap('savedPlaces').size, 2)
  assert.equal(await places.getByLabel(`place label ${unresolved.placeId}`, { exact: true }).inputValue(), 'Weekend market link')
  assert.equal(navigations, 0); assert.deepEqual(errors, [])
  console.log(JSON.stringify({ verified: true, budgetCards: 1, placesCards: 1, visibleLegacyData: true, compactSizing: true, visibleMapContentAndFailureFallback: true, splitMapsAfterRestart: true, liveBudgetUpdates: true, browserEditsSeenByChat: true, confirmedPins: true, unresolvedLinks: true, replayAfterRestart: true, mockReplies: sends.length, navigations, sockets, realPhoneTest: false }, null, 2))
} finally { provider?.destroy(); observer.destroy(); await browser?.close(); await stop(); fs.rmSync(dataDir, { recursive: true, force: true }) }
