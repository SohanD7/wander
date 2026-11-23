// Self-contained ZeroSettle signed-webhook + Chromium + actual relay-process restart verification.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chromium } from 'playwright'
import { sampleEvent, signSample } from '../server/zerosettle-sample.mjs'

const port = Number(process.env.PILOT_PORT ?? 1244)
const base = `http://127.0.0.1:${port}`
const webhookUrl = `${base}/webhooks/zerosettle`
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-zerosettle-browser-'))
let relay
let browser
async function start() {
  relay = spawn(process.execPath, ['server/pilot-demo.mjs'], {
    env: { ...process.env, PILOT_ZEROSETTLE_PLANNING_SAMPLES: '0', PILOT_PORT: String(port), PILOT_DATA_DIR: dataDir, PILOT_ZEROSETTLE_SAMPLES: '1', TWILIO_CONVERSATIONS_ENABLED: '0', TWILIO_SMS_ENABLED: '0', LOCAL_TEST_MESSAGES: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Relay readiness timed out')), 10000)
    relay.once('error', reject)
    relay.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Relay exited: ${code}`)) })
    relay.stdout.on('data', (chunk) => {
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
  await stop()
  await start()
  // The same page stays open and its provider reconnects normally.
  await page.waitForFunction(() => document.querySelector('[aria-label="live"]') !== null)
  for (const who of ['alice', 'bob']) assert.equal((await post(sampleEvent(who))).count, 2)
  await post(sampleEvent('invalid'), true)
  await count(2)
  await page.waitForTimeout(500)
  assert.equal((await lisbon.innerText()).trim(), '2')
  assert.equal((await page.getByRole('button', { name: 'vote for Porto', exact: true }).innerText()).trim(), '0')
  assert.ok(sockets.length >= 2, 'board reconnected through WebSocket after restart')
  assert.equal(navigations, 0)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: '/tmp/wander-zerosettle-pilot-verified.png', fullPage: true })
  console.log(JSON.stringify({ verified: true, counts: [0, 1, 2, 2], replayAfterRestart: 2, invalidSignature: 401, navigations, sockets }, null, 2))
} finally {
  if (browser) await browser.close()
  await stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
}
