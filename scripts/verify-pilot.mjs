// Run against a fresh `node server/pilot-demo.mjs` instance.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = `http://127.0.0.1:${process.env.PILOT_PORT ?? 1240}`
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  const sockets = []
  page.on('websocket', (ws) => sockets.push(ws.url()))
  await page.goto(`${base}/t/pilot-lisbon-demo`)
  await page.getByRole('textbox', { name: 'your name', exact: true }).fill('Pilot observer')
  await page.getByRole('button', { name: 'continue as guest', exact: true }).click()
  const lisbon = page.getByRole('button', { name: 'vote for Lisbon', exact: true })
  await lisbon.waitFor()
  await page.getByLabel('live', { exact: true }).waitFor()
  assert.equal((await lisbon.innerText()).trim(), '0', 'Use a fresh pilot demo instance')
  assert.ok(sockets.some((url) => url.endsWith('/sync/wander-pilot-lisbon-demo')))
  // Count navigations after the initial board is loaded; neither request may reload it.
  let navigations = 0
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++ })
  const message = { messageId: 'pilot-msg-001', tripId: 'pilot-lisbon-demo', senderId: 'pilot-chat-alice', text: 'I vote for Lisbon' }
  const post = async () => {
    const response = await fetch(`${base}/local/test-message`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message),
    })
    assert.equal(response.status, 200)
    return response.json()
  }
  assert.deepEqual(await post(), { ok: true, duplicate: false, tripId: message.tripId, messageId: message.messageId, count: 1 })
  await page.waitForFunction(() => document.querySelector('[aria-label="vote for Lisbon"]')?.textContent.trim() === '1')
  assert.equal(await page.getByRole('button', { name: 'vote for Porto', exact: true }).innerText(), '0')
  const replay = await post()
  assert.equal(replay.duplicate, true)
  assert.equal(replay.count, 1)
  await page.waitForTimeout(500)
  assert.equal((await lisbon.innerText()).trim(), '1')
  assert.equal(navigations, 0)
  assert.deepEqual(errors, [])
  const screenshot = '/tmp/wander-pilot-verified.png'
  await page.screenshot({ path: screenshot, fullPage: true })
  console.log(JSON.stringify({ verified: true, websocket: sockets, countBefore: 0, countAfter: 1, countAfterReplay: 1, navigations, screenshot }, null, 2))
} finally { await browser.close() }
