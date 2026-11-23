// Exercise the hosted relay on the linked database without touching pilot trips or sending messages.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { hostedDatabaseUrl } from '../server/hosted/connection.mjs'
import { startHosted } from '../server/hosted/service.mjs'
import { sampleConfig, signSample } from '../server/zerosettle-sample.mjs'

const url = hostedDatabaseUrl()
if (!url) throw Error('Deploy Neon and pull its environment before running this check.')
const schema = 'wander_verify_' + randomUUID().replaceAll('-', '')
const admin = new Client({ connectionString: url })
const chat = 'iMessage;+;chatWanderVerification'
const handle = '+12025550123'
const sent = []
async function provider(endpoint, init) {
  if (endpoint.endsWith('/groups'))
    return Response.json({ groups: [{ chat_id: chat, participants: [handle] }] })
  assert.equal(endpoint, 'https://portal.zerosettle.io/api/imessage/send')
  sent.push(JSON.parse(init.body))
  return Response.json({ ok: true, status: 'message_sent', id: sent.length })
}
let relay,
  reader,
  created = false
async function post(id, text) {
  const raw = JSON.stringify({
    event: 'message.received',
    message: {
      kind: 'message',
      direction: 'in',
      status: 'received',
      chat_id: chat,
      handle,
      id,
      text,
    },
  })
  const response = await fetch('http://127.0.0.1:' + relay.port + '/webhooks/zerosettle', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zerosettle-signature': signSample(raw) },
    body: raw,
  })
  assert.equal(response.status, 200)
  return response.json()
}
try {
  await admin.connect()
  await admin.query('CREATE SCHEMA ' + schema)
  created = true
  const scoped = new URL(url)
  scoped.searchParams.set(
    'options',
    ((scoped.searchParams.get('options') || '') + ' -c search_path=' + schema).trim(),
  )
  reader = new Client({ connectionString: scoped.href })
  await reader.connect()
  assert.equal((await reader.query('SELECT current_schema() AS name')).rows[0].name, schema)
  const start = () =>
    startHosted({
      host: '127.0.0.1',
      handoff: false,
      fetch: provider,
      env: {
        PORT: '0',
        DATABASE_URL_UNPOOLED: scoped.href,
        WANDER_PUBLIC_ORIGIN: 'https://wander.example',
        WANDER_CLAIM_KEY: schema,
        ZEROSETTLE_ENABLED: '1',
        ZEROSETTLE_API_KEY: 'sample-only',
        ZEROSETTLE_ACCOUNT_SCOPE: schema,
        ZEROSETTLE_ALLOWED_GROUPS: chat,
        ZEROSETTLE_WEBHOOK_SECRET: sampleConfig.webhookSecret,
      },
    })
  relay = await start()
  const base = 'http://127.0.0.1:' + relay.port
  assert.deepEqual(await (await fetch(base + '/health')).json(), { ok: true })
  assert.match(await (await fetch(base)).text(), /name="wander-hosted"/)
  console.log('PASS built Wander app served over HTTP; database health returned {"ok":true}')
  await post(1, '@Wanda start a trip Neon verification')
  const vote = await post(2, 'I vote for Lisbon')
  assert.equal(vote.count, 1)
  const saved = (await reader.query('SELECT id, octet_length(snapshot) AS bytes FROM wander_trip')).rows
  assert.equal(saved.length, 1)
  assert.ok(saved[0].bytes > 0)
  assert.equal(sent.length, 1)
  console.log(
    'PASS signed webhook created a trip and one Lisbon vote; independent PostgreSQL session read its saved canvas',
  )
  await relay.close()
  relay = undefined
  relay = await start()
  const replay = await post(2, 'I vote for Lisbon')
  assert.equal(replay.duplicate, true)
  assert.equal(replay.count, 1)
  assert.equal(replay.tripId, saved[0].id)
  await post(1, '@Wanda start a trip Neon verification')
  assert.equal(sent.length, 1)
  console.log(
    'PASS relay restart restored the same trip; replay kept the vote at one and produced no second invitation',
  )
} finally {
  try {
    await relay?.close()
    await reader?.end()
    if (created) {
      await admin.query('DROP SCHEMA ' + schema + ' CASCADE')
      console.log('Removed isolated verification schema')
    }
  } finally {
    await admin.end()
  }
}
