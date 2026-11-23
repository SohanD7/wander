// Isolated Chromium + signed checklist actions + actual relay restart. All replies are mocked.
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
import { checklistItems } from '../src/collab/checklists.mjs'
import { sampleEvent, signSample } from '../server/zerosettle-sample.mjs'
const port = Number(process.env.PILOT_PORT ?? 1250), base = `http://127.0.0.1:${port}`
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-list-browser-'))
let relay, browser, provider
const observer = new Y.Doc(), sends = []
const until = async (fn) => { const end = Date.now() + 6000; while (!fn()) { if (Date.now() > end) throw Error('Sync timed out'); await new Promise((r) => setTimeout(r, 20)) } }
async function start() {
  relay = spawn(process.execPath, ['server/pilot-demo.mjs'], { env: { ...process.env, PILOT_ZEROSETTLE_PLANNING_SAMPLES: '0', PILOT_PORT: String(port), PILOT_DATA_DIR: dataDir,
    PILOT_ZEROSETTLE_POLL_SAMPLES: '0', PILOT_ZEROSETTLE_LIST_SAMPLES: '1', PILOT_ZEROSETTLE_LINK_SAMPLES: '0', TWILIO_CONVERSATIONS_ENABLED: '0', TWILIO_SMS_ENABLED: '0', LOCAL_TEST_MESSAGES: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Readiness timed out')), 10000)
    relay.once('error', reject); relay.once('exit', (code) => { clearTimeout(timeout); reject(Error(`Relay exited ${code}`)) })
    let buffered = ''
    relay.stdout.on('data', (chunk) => {
      buffered += chunk.toString(); const lines = buffered.split('\n'); buffered = lines.pop()
      for (const line of lines) if (line.startsWith('SAMPLE_ZEROSETTLE_LIST_REPLY ')) sends.push(JSON.parse(line.slice('SAMPLE_ZEROSETTLE_LIST_REPLY '.length)))
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
  await page.goto(base + '/t/pilot-lisbon-demo')
  await page.getByRole('textbox', { name: 'your name', exact: true }).fill('Checklist observer')
  await page.getByRole('button', { name: 'continue as guest', exact: true }).click()
  await page.getByLabel('live', { exact: true }).waitFor()
  let navigations = 0; page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++ })
  const event = (id, text) => ({ ...sampleEvent('alice'), message: { ...sampleEvent('alice').message, id, text } })
  const first = event(89001, 'Wanda LiSt Packing | Passport | Charger | Sunscreen')
  const created = await post(first)
  assert.equal(created.reply, 'Created Packing with 3 items.')
  const card = page.locator(`#widget-${created.widgetId}`)
  await card.getByLabel('list title', { exact: true }).waitFor()
  assert.equal(await card.getByLabel('list item', { exact: true }).count(), 3)
  await card.getByText('— Alice', { exact: true }).waitFor()
  const added = event(89002, '@Wanda ADD TO packing | Water bottle | Sunglasses')
  await post(added)
  await page.waitForFunction((id) => document.getElementById(`widget-${id}`)?.querySelectorAll('[aria-label="list item"]').length === 5, created.widgetId)
  const done = event(89003, '@Wanda done Packing | Passport')
  await post(done)
  await page.waitForFunction((id) => document.getElementById(`widget-${id}`)?.querySelector('[aria-label="check off Passport"]')?.checked === true, created.widgetId)
  // Subsequent chat must see actual browser title and item edits.
  await card.getByLabel('list title', { exact: true }).fill('Travel kit')
  await card.getByLabel('list item', { exact: true }).nth(1).fill('USB-C charger')
  await card.getByPlaceholder('add item', { exact: true }).fill('Hat')
  await card.getByRole('button', { name: 'add item', exact: true }).click()
  await until(() => observer.getMap('widgets').get(created.widgetId)?.title === 'Travel kit' && checklistItems(observer, observer.getMap('widgets').get(created.widgetId)).some((i) => i.text === 'USB-C charger'))
  const duplicate = event(89004, '@Wanda add to Travel kit | usb-c charger | https://example.com/map')
  assert.ok((await post(duplicate)).reply.includes('Already present: usb-c charger'))
  const undone = event(89005, 'Wanda undo travel kit | Passport')
  await post(undone)
  await page.waitForFunction((id) => document.getElementById(`widget-${id}`)?.querySelector('[aria-label="check off Passport"]')?.checked === false, created.widgetId)
  await post(event(89006, '@Wanda done Travel kit | USB-C CHARGER'))
  await page.waitForFunction((id) => document.getElementById(`widget-${id}`)?.querySelector('[aria-label="check off USB-C charger"]')?.checked === true, created.widgetId)
  assert.equal(await card.getByLabel('list item', { exact: true }).count(), 7)
  assert.equal(await page.getByPlaceholder('write something for the crew…').count(), 0)
  assert.ok((await post(event(89007, '@Wanda done Travel kit | Missing'))).reply.includes('I couldn’t find'))
  await until(() => sends.length === 7 && observer.getMap('pilotListDeliveries').get('zerosettle.message.received.89007')?.state === 'sent')
  await stop(); await start()
  for (const payload of [first, added, done, duplicate, undone]) assert.equal((await post(payload)).duplicate, true)
  await page.getByLabel('live', { exact: true }).waitFor()
  await page.waitForFunction((id) => document.getElementById(`widget-${id}`)?.querySelectorAll('[aria-label="list item"]').length === 7, created.widgetId)
  assert.equal(await card.getByLabel('list title', { exact: true }).inputValue(), 'Travel kit')
  assert.equal(await card.getByLabel('check off Passport', { exact: true }).isChecked(), false)
  assert.equal(await card.getByLabel('check off USB-C charger', { exact: true }).isChecked(), true)
  assert.equal(await page.locator('[id^="widget-w_list_"]').count(), 1)
  assert.equal(sends.length, 7)
  assert.equal(navigations, 0); assert.deepEqual(errors, [])
  await page.screenshot({ path: '/tmp/wander-zerosettle-lists-verified.png', fullPage: true })
  console.log(JSON.stringify({ verified: true, liveLists: 1, items: 7, mockReplies: sends.length, browserEditsSeenByChat: true, completionAndUndo: true, replayAfterRestart: true, navigations, sockets, realPhoneTest: false }, null, 2))

} finally { provider?.destroy(); observer.destroy(); await browser?.close(); await stop(); fs.rmSync(dataDir, { recursive: true, force: true }) }
