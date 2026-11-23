// Self-contained ZeroSettle signed-webhook + Chromium + actual relay-process restart verification.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chromium } from 'playwright'
import { sampleConfig, sampleEvent, signSample } from '../server/zerosettle-sample.mjs'

const port = Number(process.env.PILOT_PORT ?? 1246)
const base = `http://127.0.0.1:${port}`
const webhookUrl = `${base}/webhooks/zerosettle`
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-zerosettle-browser-'))
const acknowledgments = []
let relay
let browser
async function start() {
  relay = spawn(process.execPath, ['server/pilot-demo.mjs'], {
    env: { ...process.env, PILOT_ZEROSETTLE_PLANNING_SAMPLES: '0', PILOT_PORT: String(port), PILOT_DATA_DIR: dataDir, PILOT_ZEROSETTLE_SAMPLES: '1', PILOT_ZEROSETTLE_LINK_SAMPLES: '1', TWILIO_CONVERSATIONS_ENABLED: '0', TWILIO_SMS_ENABLED: '0', LOCAL_TEST_MESSAGES: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Relay readiness timed out')), 10000)
    relay.once('error', reject)
    relay.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Relay exited: ${code}`)) })
    let buffered = ''
    relay.stdout.on('data', (chunk) => {
      buffered += chunk.toString()
      const lines = buffered.split('\n')
      buffered = lines.pop()
      for (const line of lines) {
        if (line.startsWith('SAMPLE_ZEROSETTLE_ACK ')) acknowledgments.push(JSON.parse(line.slice('SAMPLE_ZEROSETTLE_ACK '.length)))
      }
      if (chunk.toString().includes('Pilot ready:')) { clearTimeout(timeout); resolve() }
    })
    relay.stderr.on('data', (chunk) => process.stderr.write(chunk))
  })
}
async function stop() {
  if (relay && relay.exitCode === null) {
    const exited = once(relay, 'exit')
    relay.kill('SIGTERM')
    await exited
  }
}
async function post(event, invalid = false) {
  const response = await fetch(webhookUrl, {
    method: 'POST', headers: { 'content-type': 'application/json',
      'x-zerosettle-signature': invalid ? 'invalid' : signSample(JSON.stringify(event)) }, body: JSON.stringify(event),
  })
  assert.equal(response.status, invalid ? 401 : 200)
  return response.json()
}
try {
  await start()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  const sockets = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('websocket', (ws) => sockets.push(ws.url()))
  await page.goto(`${base}/t/pilot-lisbon-demo`)
  await page.getByRole('textbox', { name: 'your name', exact: true }).fill('ZeroSettle pilot observer')
  await page.getByRole('button', { name: 'continue as guest', exact: true }).click()
  const lisbon = page.getByRole('button', { name: 'vote for Lisbon', exact: true })
  await lisbon.waitFor()
  await page.getByLabel('live', { exact: true }).waitFor()
  assert.equal((await lisbon.innerText()).trim(), '0')
  let navigations = 0
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++ })
  const count = async (n) => page.waitForFunction((expected) => document.querySelector('[aria-label="vote for Lisbon"]')?.textContent.trim() === expected, String(n))
  await post(sampleEvent('invalid'), true)
  await count(0)
  assert.equal((await post(sampleEvent('alice'))).count, 1)
  await count(1)
  assert.equal((await post(sampleEvent('bob'))).count, 2)
  await count(2)
  for (const who of ['alice', 'bob']) assert.deepEqual(await post(sampleEvent(who)), {
    ok: true, duplicate: true, tripId: 'pilot-lisbon-demo', messageId: `zerosettle.message.received.${sampleEvent(who).message.id}`, count: 2,
  })
  assert.equal(await lisbon.getAttribute('title'), 'Alice, bob@example.com')
  const scroller = page.locator('.scrollbar-none.h-full.overflow-auto')
  await scroller.evaluate((el) => { el.scrollTop = 80; el.scrollLeft = 24 })
  const viewportBefore = await scroller.evaluate((el) => [el.scrollTop, el.scrollLeft])
  const shared = sampleEvent('alice')
  shared.message.id = 71003
  shared.message.text = 'i vote for Porto https://example.com/stay?x=1&y=2\nNice place near the river'
  const saved = await post(shared)
  assert.equal(saved.cardIds.length, 1)
  assert.equal(saved.count, 1)
  const note = page.getByPlaceholder('write something for the crew…')
  await note.waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some((el) => el.value.includes('Nice place near the river')))
  assert.ok((await note.inputValue()).includes('https://example.com/stay?x=1&y=2'))
  await page.getByText('— Alice', { exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('[aria-label="vote for Porto"]')?.textContent.trim() === '1')
  await page.waitForTimeout(100)
  assert.deepEqual(acknowledgments, [{ chatId: sampleConfig.chatId, text: 'Saved to your trip board.' }])
  assert.equal((await post(shared)).duplicate, true)
  await stop()
  await start()
  // The same page stays open and its provider reconnects normally.
  await page.waitForFunction(() => document.querySelector('[aria-label="live"]') !== null)
  for (const who of ['alice', 'bob']) assert.equal((await post(sampleEvent(who))).count, 2)
  await post(sampleEvent('invalid'), true)
  await count(2)
  assert.equal((await post(shared)).duplicate, true)
  await page.waitForTimeout(500)
  assert.equal(await note.count(), 1)
  assert.equal(acknowledgments.length, 1)
  assert.equal((await lisbon.innerText()).trim(), '2')
  assert.equal((await page.getByRole('button', { name: 'vote for Porto', exact: true }).innerText()).trim(), '1')
  assert.ok(sockets.length >= 2, 'board reconnected through WebSocket after restart')
  assert.equal(navigations, 0)
  const comment = sampleEvent('alice')
  comment.message.id = 72000
  comment.message.ts_ms = Date.now()
  comment.message.text = 'Nice spot for lunch'
  const link = sampleEvent('alice')
  link.message.id = 72001
  link.message.ts_ms = comment.message.ts_ms + 5400
  link.message.text = 'bomb.com'
  await post(comment)
  await stop()
  await start()
  await post(link)
  await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some((el) => el.value === 'https://bomb.com\n\nNice spot for lunch'))
  await page.waitForTimeout(100)
  assert.equal((await post(link)).duplicate, true)
  assert.equal((await post(comment)).duplicate, true)
  assert.equal(acknowledgments.length, 2)
  assert.equal(await note.count(), 2)
  assert.deepEqual(await scroller.evaluate((el) => [el.scrollTop, el.scrollLeft]), viewportBefore)
  const boxes = await page.locator('.bg-dot-grid section').evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }
  }))
  assert.equal(boxes.length, 3)
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, b] = [boxes[i], boxes[j]]
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'rendered cards must not overlap')
  }
  assert.equal(navigations, 0)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: '/tmp/wander-zerosettle-links-verified.png', fullPage: true })
  console.log(JSON.stringify({ verified: true, linkCards: 2, compactPlacement: true, steadyViewport: true, splitCommentAcrossRestart: true, mockAcknowledgments: acknowledgments.length, counts: [0, 1, 2, 2], replayAfterRestart: 2, invalidSignature: 401, navigations, sockets }, null, 2))
} finally {
  if (browser) await browser.close()
  await stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
}
