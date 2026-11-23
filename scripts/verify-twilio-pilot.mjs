// Self-contained signed-webhook + Chromium + actual relay-process restart verification.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chromium } from 'playwright'
import { sampleConfig, sampleEvent, signSample } from '../server/twilio-sample.mjs'

const port = Number(process.env.PILOT_PORT ?? 1242)
const base = `http://127.0.0.1:${port}`
const config = sampleConfig(port)
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wander-twilio-browser-'))
let relay
let browser
async function start() {
  relay = spawn(process.execPath, ['server/pilot-demo.mjs'], {
    env: { ...process.env, PILOT_PORT: String(port), PILOT_DATA_DIR: dataDir, PILOT_TWILIO_SAMPLES: '1' },
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
  const response = await fetch(config.webhookUrl, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': invalid ? 'invalid' : signSample(config, event) }, body: new URLSearchParams(event),
  })
  assert.equal(response.status, invalid ? 403 : 200)
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
  await page.getByRole('textbox', { name: 'your name', exact: true }).fill('Twilio pilot observer')
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
    ok: true, duplicate: true, tripId: 'pilot-lisbon-demo', messageId: sampleEvent(who).MessageSid, count: 2,
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
  const board = await post(sampleEvent('board', 'board'))
  assert.equal(board.reply.mode, 'dry-run')
  assert.equal(board.reply.body, `${base}/t/pilot-lisbon-demo`)
  await page.screenshot({ path: '/tmp/wander-twilio-pilot-verified.png', fullPage: true })
  console.log(JSON.stringify({ verified: true, counts: [0, 1, 2, 2], replayAfterRestart: 2, invalidSignature: 403, navigations, sockets, boardReply: 'dry-run' }, null, 2))
} finally {
  if (browser) await browser.close()
  await stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
}
