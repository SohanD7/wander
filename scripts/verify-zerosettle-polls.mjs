// Isolated Chromium + signed events + actual relay restart. All native sends are mocked.
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
import { sampleConfig, sampleEvent, signSample } from '../server/zerosettle-sample.mjs'
const port = Number(process.env.PILOT_PORT ?? 1248), base = `http://127.0.0.1:${port}`
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-poll-browser-'))
let relay, browser, provider
const observer = new Y.Doc(), sends = []
const until = async (fn) => { const end = Date.now() + 6000; while (!fn()) { if (Date.now() > end) throw Error('Sync timed out'); await new Promise((r) => setTimeout(r, 20)) } }
async function start() {
  relay = spawn(process.execPath, ['server/pilot-demo.mjs'], { env: { ...process.env, PILOT_ZEROSETTLE_PLANNING_SAMPLES: '0', PILOT_PORT: String(port), PILOT_DATA_DIR: dataDir,
    PILOT_ZEROSETTLE_POLL_SAMPLES: '1', PILOT_ZEROSETTLE_LINK_SAMPLES: '0', TWILIO_CONVERSATIONS_ENABLED: '0', TWILIO_SMS_ENABLED: '0', LOCAL_TEST_MESSAGES: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Readiness timed out')), 10000)
    relay.once('error', reject); relay.once('exit', (code) => { clearTimeout(timeout); reject(Error(`Relay exited ${code}`)) })
    let buffered = ''
    relay.stdout.on('data', (chunk) => {
      buffered += chunk.toString(); const lines = buffered.split('\n'); buffered = lines.pop()
      for (const line of lines) if (line.startsWith('SAMPLE_ZEROSETTLE_POLL_SEND ')) sends.push(JSON.parse(line.slice('SAMPLE_ZEROSETTLE_POLL_SEND '.length)))
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
  await page.getByRole('textbox', { name: 'your name', exact: true }).fill('Poll observer')
  await page.getByRole('button', { name: 'continue as guest', exact: true }).click()
  await page.getByLabel('live', { exact: true }).waitFor()
  let navigations = 0; page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++ })
  const command = sampleEvent('alice'); command.message.id = 88001; command.message.text = '@wAnDa PoLl Where should we go? | Lisbon | Porto'
  const created = await post(command)
  const card = page.locator(`#widget-${created.pollWidgetId}`)
  await card.waitFor()
  await card.getByText('iMessage poll accepted', { exact: false }).waitFor()
  assert.equal(await card.getByLabel('vote question', { exact: true }).inputValue(), 'Where should we go?')
  await until(() => observer.getMap('pilotNativePolls').get(created.messageId)?.providerMessageId)
  const mapping = observer.getMap('pilotNativePolls').get(created.messageId)
  const options = Object.keys(mapping.optionMap)
  const event = (id, who, option_ids, ts_ms = id) => ({ event: 'poll.voted', message: { id, kind: 'poll_vote', direction: 'in', status: 'received',
    handle: sampleConfig.testers[who === 'alice' ? 0 : 1], chat_id: sampleConfig.chatId, target_id: mapping.providerMessageId, target_guid: mapping.providerGuid, ts_ms, vote: { option_ids }, poll: null } })
  // Read the rendered counts, never reload/navigate the open board.
  async function counts(a, b) {
    await page.waitForFunction(({ id, a, b }) => { const el = document.getElementById(`widget-${id}`); return el?.querySelector('[aria-label="vote for Lisbon"]')?.textContent.trim() === String(a) && el?.querySelector('[aria-label="vote for Porto"]')?.textContent.trim() === String(b) }, { id: created.pollWidgetId, a, b })
  }
  const first = event(88002, 'alice', [options[0], options[1]])
  const second = event(88003, 'bob', [options[0]])
  await post(first); await post(second); await counts(2, 1)
  assert.equal(await card.getByLabel('vote for Lisbon', { exact: true }).getAttribute('title'), 'Alice, Bob')
  const changed = event(88004, 'alice', [options[1]])
  await post(changed); await counts(1, 1)
  const removed = event(88005, 'bob', [])
  await post(removed); await counts(0, 1)
  await post(event(88006, 'alice', [options[0]], 88001)); await counts(0, 1)
  await post(first, true); await counts(0, 1)
  // A browser vote still works and does not produce an outbound API call.
  await card.getByLabel('vote for Lisbon', { exact: true }).click(); await counts(1, 1)
  await card.getByLabel('vote question', { exact: true }).fill('Edited on canvas')
  await until(() => observer.getMap('widgets').get(created.pollWidgetId)?.question === 'Edited on canvas')
  await stop(); await start()
  for (const payload of [command, first, second, changed, removed]) assert.equal((await post(payload)).duplicate, true)
  await counts(1, 1)
  assert.equal(await card.getByLabel('vote question', { exact: true }).inputValue(), 'Edited on canvas')
  assert.equal(await page.locator('[id^="widget-w_poll_"]').count(), 1)
  assert.equal(sends.length, 1); assert.equal(sends[0].kind, 'poll')
  assert.equal(navigations, 0); assert.deepEqual(errors, [])
  await page.screenshot({ path: '/tmp/wander-zerosettle-polls-verified.png', fullPage: true })
  console.log(JSON.stringify({ verified: true, canvasPolls: 1, mockNativeSends: sends.length, liveSelections: [[2, 1], [1, 1], [0, 1]], canvasVotePreserved: true, replayAfterRestart: true, navigations, sockets, realPhoneTest: false }, null, 2))
} finally { provider?.destroy(); observer.destroy(); await browser?.close(); await stop(); fs.rmSync(dataDir, { recursive: true, force: true }) }
