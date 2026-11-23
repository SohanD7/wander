// No account credentials or network provider calls. Real HTTP, Chromium, WebSocket and on-disk Postgres engine.
import { execFileSync, spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import * as Y from 'yjs'
import { seedPilotTrip } from '../server/pilot-fixture.mjs'
import { zeroSettleSenderId } from '../server/zerosettle-protocol.mjs'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import WebSocket from 'ws'
import { startHosted } from '../server/hosted/service.mjs'
import { signSample, sampleConfig } from '../server/zerosettle-sample.mjs'
const dir = mkdtempSync(path.join(tmpdir(), 'wander-hosted-')),
  origin = 'http://127.0.0.1:1257'
const A = 'iMessage;+;chatA',
  B = 'iMessage;+;chatB',
  alice = '+12025550101',
  bob = '+12025550102'
const env = {
  ZEROSETTLE_ENABLED: '1',
  ZEROSETTLE_API_KEY: 'test-only',
  ZEROSETTLE_WEBHOOK_SECRET: sampleConfig.webhookSecret,
  ZEROSETTLE_ACCOUNT_SCOPE: 'sandbox',
  ZEROSETTLE_ALLOWED_GROUPS: '*',
  WANDER_PUBLIC_ORIGIN: origin,
  WANDER_CLAIM_KEY: 's'.repeat(40),
  PORT: '1257',
  ZEROSETTLE_LISTS: '1',
  ZEROSETTLE_POLLS: '1',
  ZEROSETTLE_PLACES: '1',
  ZEROSETTLE_BUDGETS: '1',
}
const groups = [
  { chat_id: A, participants: [alice, bob] },
  { chat_id: B, participants: [bob] },
]
const deliveries = []
let dmFailure = 0
const mock = async (url, init) => {
  if (url.endsWith('/groups')) return Response.json({ groups })
  assert.equal(url, 'https://portal.zerosettle.io/api/imessage/send')
  const payload = JSON.parse(init.body)
  deliveries.push(payload)
  if (payload.to && dmFailure) return Response.json({}, { status: dmFailure })
  return Response.json({
    ok: true,
    status: 'message_sent',
    id: 5000 + deliveries.length,
    ...(payload.poll
      ? {
          record: {
            id: 5000 + deliveries.length,
            kind: 'poll',
            direction: 'out',
            status: 'sent',
            chat_id: payload.chat_id,
            poll: { options: payload.poll.options.map((text, i) => ({ id: String(i), text })) },
          },
        }
      : {}),
  })
}
// Optionally exercise node-postgres against a fresh native cluster on a private Unix socket.
const bin = process.env.WANDER_TEST_PG_BIN
let nativeStarted = false
function startDatabase() {
  if (!bin) return
  const data = path.join(dir, 'db')
  execFileSync(path.join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'wander_test', '--no-locale'], {
    stdio: 'ignore',
  })
  execFileSync(path.join(bin, 'pg_ctl'), [
    '-D',
    data,
    '-l',
    path.join(dir, 'postgres.log'),
    '-o',
    "-c listen_addresses='' -k " + dir,
    '-w',
    'start',
  ])
  nativeStarted = true
  env.DATABASE_URL = 'postgresql://wander_test@localhost/postgres?host=' + encodeURIComponent(dir)
  env.DATABASE_URL_UNPOOLED = env.DATABASE_URL
}
async function verifyDockerEntrypoint() {
  // This scope has no trips and no provider work. Exercise the actual production startup command.
  const child = spawn(process.execPath, ['server/relay.mjs'], {
    env: {
      ...process.env,
      ...env,
      HOST: '127.0.0.1',
      WANDER_GROUP_TRIPS: '1',
      WANDER_PUBLIC_ORIGIN: 'https://wander.example',
      ZEROSETTLE_ACCOUNT_SCOPE: 'empty-startup-test',
    },
    stdio: 'ignore',
  })
  const finished = once(child, 'exit')
  try {
    for (let i = 0; i < 100 && child.exitCode === null; i++) {
      const response = await fetch(origin + '/health').catch(() => null)
      if (response?.ok) return
      await delay(100)
    }
    throw Error('The production entry point did not become healthy')
  } finally {
    child.kill('SIGTERM')
    await finished
  }
}
let offset = 0
const start = (port = env.PORT) =>
  startHosted({
    env: { ...env, PORT: port },
    clock: () => Date.now() + offset,
    testDir: bin ? undefined : dir,
    fetch: mock,
    host: '127.0.0.1',
  })
const post = async (chat, id, text, handle = alice) => {
  const raw = JSON.stringify({
    event: 'message.received',
    message: { kind: 'message', status: 'received', direction: 'in', chat_id: chat, handle, id, text },
  })
  return fetch(origin + '/webhooks/zerosettle', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zerosettle-signature': signSample(raw) },
    body: raw,
  })
}
let service, browser
try {
  startDatabase()
  if (bin) {
    await verifyDockerEntrypoint()
    const doc = new Y.Doc()
    seedPilotTrip(doc)
    doc.getMap('members').set(zeroSettleSenderId(bob), { name: 'Original traveler' })
    doc.getMap('votes').set('w_destination|o_porto|' + zeroSettleSenderId(bob), 1)
    doc.getMap('pilotAcknowledgments').set('old', { state: 'pending', chatId: B })
    const bytes = Buffer.from(Y.encodeStateAsUpdate(doc))
    const file = path.join(
      dir,
      createHash('sha256').update('wander-original').digest('hex').slice(0, 32) + '.ydoc',
    )
    writeFileSync(file, bytes)
    doc.destroy()
    const options = {
      env: {
        ...process.env,
        ...env,
        PILOT_DATA_DIR: dir,
        ZEROSETTLE_IMPORT_LINE: 'single',
        ZEROSETTLE_TRIP_ID: 'original',
        ZEROSETTLE_CHAT_ID: B,
        ZEROSETTLE_TESTER_HANDLES: bob,
        ZEROSETTLE_TESTER_NAMES: '{}',
      },
    }
    const importer = () =>
      execFileSync(process.execPath, ['scripts/import-group-pilot.mjs'], options).toString()
    assert.ok(importer().includes('Imported'))
    assert.ok(importer().includes('No import'))
    assert.deepEqual(readFileSync(file), bytes)
  }
  service = await start()
  const first = await Promise.all([
    post(A, 1, '@Wanda start a trip Summer Vacation'),
    post(A, 1, '@Wanda start a trip Summer Vacation'),
    post(B, 1, 'Wanda start a trip Winter Trip', bob),
  ])
  assert.deepEqual(
    first.map((r) => r.status),
    [200, 200, 200],
  )
  assert.equal(deliveries.length, 2)
  await post(A, 2, 'Wanda board')
  const link = (chat) =>
    deliveries
      .find((p) => p.chat_id === chat)
      .text.split(' ')
      .at(-1)
  const trip = (chat) => new URL(link(chat)).pathname.split('/').pop()
  assert.equal(deliveries[2].text, deliveries.find((p) => p.chat_id === A).text)
  assert.notEqual(trip(A), trip(B))
  assert.equal((await post(B, 3, 'I vote for Porto')).status, 403)
  assert.equal((await post(A, 3, 'I vote for Lisbon')).status, 422)
  for (const [id, cmd] of [

    [4, 'Wanda budget USD 750.50 per person'],
    [5, 'Wanda list Packing | Passport'],
    [6, 'A cabin https://example.com/cabin'],
    [7, 'Wanda place https://www.google.com/maps/search/?api=1&query=47.6,-122.3'],
    [8, 'Wanda choose 1'],
    [9, 'Wanda poll Dinner? | Early | Late'],
  ])
    assert.equal((await post(A, id, cmd)).status, 200)
  await post(B, 10, 'Wanda list Winter gear | Skis', bob)
  assert.equal((await fetch(origin + '/t/' + trip(A))).status, 401)
  async function denied(route, headers = {}) {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(origin.replace('http', 'ws') + route, { headers, origin })
      ws.once('open', () => {
        ws.close()
        reject(Error('Unexpected open socket'))
      })
      ws.once('error', () => resolve())
    })
  }
  await denied('/live/' + trip(A))
  await denied('/sync/wander-' + trip(A))
  const created = await fetch(origin + '/api/manual-trip', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Private canvas', name: 'Canvas owner' }),
  })
  assert.equal(created.status, 201)
  const { path: manualPath } = await created.json()
  const manualCookie = created.headers.get('set-cookie').split(';')[0]
  const manualApi = origin + '/api/trip/' + manualPath.split('/').pop()
  assert.equal((await fetch(origin + manualPath)).status, 401)
  const manualBoard = await fetch(manualApi + '/canvas', { headers: { cookie: manualCookie } })
  assert.equal(manualBoard.status, 200)
  assert.deepEqual(await manualBoard.json(), { title: 'Private canvas', cards: [], viewerName: 'Canvas owner' })
  browser = await chromium.launch({ executablePath: process.env.WANDER_TEST_CHROMIUM })
  const manual = await browser.newContext()
  const manualPage = await manual.newPage()
  await manualPage.goto(origin)
  await manualPage.getByRole('button', { name: 'Join via group invite' }).click()
  await manualPage.getByLabel('Invite link').fill(link(A))
  await manualPage.getByRole('button', { name: 'Open invite' }).click()
  await manualPage.getByText('Which number is yours?').waitFor()
  await manualPage.goto(origin)
  await manualPage.getByRole('button', { name: 'Start a canvas' }).click()
  await manualPage.getByLabel('Trip name').fill('Manual trip')
  await manualPage.getByLabel('Your name').fill('Manual owner')
  await manualPage.getByRole('button', { name: 'Create canvas' }).click()
  await manualPage.getByRole('heading', { name: 'Manual trip' }).waitFor()
  await manualPage.getByText('Live', { exact: true }).waitFor()
  assert.equal(await manualPage.getByText('Lisbon', { exact: true }).count(), 0)
  assert.equal((await fetch(manualPage.url())).status, 401)
  await manual.close()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.route('https://maps.google.com/**', (r) => r.fulfill({ body: 'Verified map coordinates' }))
  await page.goto(link(A))
  await page.getByText('Which number is yours?').waitFor()
  assert.ok(!(await page.locator('body').innerText()).includes(alice))
  await page.screenshot({ path: '/tmp/wander-claim-mobile.png' })
  await page.locator('input[type=radio]').first().check()
  await page.getByRole('button', { name: 'Text me a code' }).click()
  await page.getByLabel('Verification code').waitFor()
  const dm = deliveries.find((d) => d.to === alice)
  assert.ok(dm && !dm.chat_id)
  const code = dm.text.match(/\d{6}/)[0]
  await page.getByLabel('Verification code').fill(code === '000000' ? '111111' : '000000')
  await page.getByRole('button', { name: 'Verify', exact: true }).click()
  await page.getByRole('alert').waitFor()
  await page.getByLabel('Verification code').fill(code)
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await page.getByLabel('Your name').fill('Alex')
  await page.getByRole('button', { name: 'Enter the trip' }).click()
  await page.getByText('Alex: USD 750.50', { exact: true }).waitFor()
  await page.getByTitle('Alex', { exact: true }).waitFor()
  await page.getByText('Passport', { exact: true }).waitFor()
  await page.getByText('Dinner?', { exact: true }).waitFor()
  await page.frameLocator('iframe').getByText('Verified map coordinates').waitFor()
  assert.equal(await page.getByText('Winter gear', { exact: true }).count(), 0)
  const before = deliveries.length
  await Promise.all([page.getByLabel('Passport').click(), post(A, 12, 'Wanda add to Packing | Charger')])
  await page.getByLabel('Charger').waitFor()
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('label')]
        .find((l) => l.textContent.includes('Passport'))
        ?.querySelector('input')?.checked,
  )
  const ses = (await ctx.cookies()).find((c) => c.name.startsWith('wander_s_'))
  const snapshot = await (await ctx.request.get(origin + '/api/trip/' + trip(A) + '/canvas')).json()
  for (const forbidden of [alice, bob, 'pilotMessageReceipts', 'pilotBudgetDeliveries', code])
    assert.ok(!JSON.stringify(snapshot.cards).includes(forbidden))
  assert.ok(ses.httpOnly)
  await denied('/live/' + trip(B), { Cookie: ses.name + '=' + ses.value })
  if (bin) {
    const replacement = await start('0')
    try {
      assert.equal((await fetch(origin + '/health')).status, 503)
      assert.equal((await fetch('http://127.0.0.1:' + replacement.port + '/health')).status, 200)
    } finally {
      await replacement.close()
    }
  }
  await service.close()
  service = await start()
  await page.reload()
  await page.getByText('Alex: USD 750.50', { exact: true }).waitFor()
  await post(A, 1, '@Wanda start a trip Summer Vacation')
  await post(A, 12, 'Wanda add to Packing | Charger')
  assert.equal(deliveries.length, before + 1)
  await page.getByRole('button', { name: 'Log out' }).click()
  await page.getByText('Which number is yours?').waitFor()
  assert.equal((await ctx.request.get(origin + '/api/trip/' + trip(A) + '/canvas')).status(), 401)
  const second = await browser.newContext()
  const bPage = await second.newPage()
  await bPage.goto(link(A))
  await bPage.getByText('Claimed by Alex').waitFor()
  const aBase = origin + '/api/trip/' + trip(A) + '/',
    bBase = origin + '/api/trip/' + trip(B) + '/'
  const headers = { origin, 'x-wander-invite': new URL(link(A)).hash.slice(1) }
  const bHeaders = { origin, 'x-wander-invite': new URL(link(B)).hash.slice(1) }
  const info = await (await second.request.get(aBase + 'invite', { headers })).json()
  const picker = info.members.find((m) => m.claimed).id
  const request = (action, data) => second.request.post(aBase + action, { headers, data })
  const latestCode = () =>
    deliveries
      .filter((d) => d.to === alice)
      .at(-1)
      .text.match(/\d{6}/)[0]
  assert.equal(
    (await second.request.post(bBase + 'challenge', { headers: bHeaders, data: { picker } })).status(),
    400,
  )
  offset += 61000
  const firstChallenge = await (await request('challenge', { picker })).json(),
    oldCode = latestCode()
  assert.equal((await request('challenge', { picker })).status(), 429)
  offset += 61000
  const newer = await (await request('challenge', { picker })).json()
  assert.equal(
    (await request('verify', { challenge: firstChallenge.challenge, code: oldCode })).status(),
    400,
  )
  offset += 301000
  assert.equal((await request('verify', { challenge: newer.challenge, code: latestCode() })).status(), 400)
  const valid = await (await request('challenge', { picker })).json()
  assert.equal(
    (
      await ctx.request.post(aBase + 'verify', {
        headers,
        data: { challenge: valid.challenge, code: latestCode() },
      })
    ).status(),
    400,
  )
  const attempts = await Promise.all([
    request('verify', { challenge: valid.challenge, code: latestCode() }),
    request('verify', { challenge: valid.challenge, code: latestCode() }),
  ])
  assert.deepEqual(attempts.map((r) => r.status()).sort(), [200, 400])
  assert.equal((await second.request.get(aBase + 'canvas')).status(), 200)
  assert.equal((await second.request.get(bBase + 'canvas')).status(), 401)
  const target = 5001 + deliveries.findIndex((d) => d.poll)
  const vote = async (chat, id) => {
    const raw = JSON.stringify({
      event: 'poll.voted',
      message: {
        id,
        chat_id: chat,
        handle: bob,
        kind: 'poll_vote',
        direction: 'in',
        status: 'received',
        ts_ms: Date.now(),
        target_id: target,
        vote: { option_ids: ['0'] },
      },
    })
    return (
      await fetch(origin + '/webhooks/zerosettle', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-zerosettle-signature': signSample(raw) },
        body: raw,
      })
    ).json()
  }
  await vote(B, 19)
  const getPoll = async () =>
    (await (await second.request.get(aBase + 'canvas')).json()).cards.find((w) => w.title === 'Dinner?')
  assert.equal((await getPoll()).options[0].voters.length, 0)
  await vote(A, 20)
  assert.equal((await getPoll()).options[0].voters.length, 1)
  groups[0].participants = [bob]
  assert.equal((await second.request.get(aBase + 'canvas')).status(), 401)
  const bInfo = await (await second.request.get(bBase + 'invite', { headers: bHeaders })).json(),
    bPicker = bInfo.members[0].id
  const bReq = (act, data) => second.request.post(bBase + act, { headers: bHeaders, data })
  for (const [status, reason] of [
    [403, 'failed'],
    [503, 'uncertain'],
  ]) {
    offset += 61000
    dmFailure = status
    const failure = await bReq('challenge', { picker: bPicker })
    assert.equal(failure.status(), 502)
    assert.ok((await failure.json()).error.includes(reason))
  }
  offset += 61000
  dmFailure = 0
  const final = await (await bReq('challenge', { picker: bPicker })).json()
  const bCode = deliveries
    .filter((p) => p.to === bob)
    .at(-1)
    .text.match(/\d{6}/)[0]
  for (let n = 0; n < 5; n++)
    assert.equal(
      (
        await bReq('verify', { challenge: final.challenge, code: bCode === '123456' ? '654321' : '123456' })
      ).status(),
      400,
    )
  assert.equal((await bReq('verify', { challenge: final.challenge, code: bCode })).status(), 400)
  if (bin) {
    offset += 3600001
    const r = await (await bReq('challenge', { picker: bPicker })).json()
    const code = deliveries
      .filter((p) => p.to === bob)
      .at(-1)
      .text.match(/\d{6}/)[0]
    assert.equal((await bReq('verify', { challenge: r.challenge, code })).status(), 200)
    await bReq('name', { name: 'Bob' })
    const canvas = await (await second.request.get(bBase + 'canvas')).json()
    assert.deepEqual(
      canvas.cards.find((w) => w.id === 'w_destination').options.find((o) => o.text === 'Porto').voters,
      ['Bob'],
    )
  }
  await second.close()
  console.log(
    'Verified two isolated trips, concurrent initialization, masked mobile claim, private code, attributed votes and budgets, links/lists/polls/places, canvas edits, logout, socket isolation and durable restart.',
  )
} finally {
  await browser?.close()
  await service?.close()
  if (nativeStarted)
    execFileSync(path.join(bin, 'pg_ctl'), ['-D', path.join(dir, 'db'), '-m', 'fast', '-w', 'stop'])
  rmSync(dir, { recursive: true, force: true })
}
