// Fresh isolated data by default; PILOT_DATA_DIR allows restart verification.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { startServer } from './relay.mjs'
import { sampleConfig } from './twilio-sample.mjs'
import { sampleConfig as zeroSettleSample } from './zerosettle-sample.mjs'
import { PILOT_TRIP_ID, seedPilotTrip } from './pilot-fixture.mjs'

if (!fs.existsSync('dist/index.html')) throw new Error('Run npm run build first')
const port = Number(process.env.PILOT_PORT ?? 1240)
const mockPlanning = process.env.PILOT_ZEROSETTLE_PLANNING_SAMPLES === '1'
const mockLists = process.env.PILOT_ZEROSETTLE_LIST_SAMPLES === '1'
const mockPolls = process.env.PILOT_ZEROSETTLE_POLL_SAMPLES === '1'
let samplePollId = Date.now() * 100
const mockLinks = process.env.PILOT_ZEROSETTLE_LINK_SAMPLES === '1'
const srv = await startServer({
  host: '127.0.0.1', port,
  dataDir: process.env.PILOT_DATA_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'wander-pilot-')),
  twilio: process.env.PILOT_TWILIO_SAMPLES === '1' ? sampleConfig(port) : undefined,
  testMessages: process.env.LOCAL_TEST_MESSAGES !== '0',
  zerosettle: process.env.PILOT_ZEROSETTLE_SAMPLES === '1' || mockLinks || mockPolls || mockLists || mockPlanning ? { ...zeroSettleSample, acknowledgments: mockLinks, polls: mockPolls, lists: mockLists, budgets: mockPlanning, places: mockPlanning, geocoderEnabled: mockPlanning, geocoderUrl: 'https://photon.example/api/', testers: mockPlanning ? [...zeroSettleSample.testers, '+12025550103'] : zeroSettleSample.testers, apiKey: 'sample-key-not-real', boardBaseUrl: 'https://wander-sample.example', testerNames: mockPolls || mockLists || mockPlanning ? { '+12025550101': 'Alice', 'bob@example.com': 'Bob', '+12025550103': 'Cara' } : mockLinks ? { '+12025550101': 'Alice' } : {} } : undefined,
  zeroSettleFetch: mockPolls || mockLists || mockPlanning ? async (_url, init) => {
    const payload = JSON.parse(init.body)
    console.log((mockPlanning ? 'SAMPLE_ZEROSETTLE_PLANNING_REPLY ' : mockLists ? 'SAMPLE_ZEROSETTLE_LIST_REPLY ' : 'SAMPLE_ZEROSETTLE_POLL_SEND ') + JSON.stringify({ kind: payload.poll ? 'poll' : 'text', chatId: payload.chat_id }))
    const id = ++samplePollId
    return Response.json({ ok: true, status: 'message_sent', id, record: { id, guid: `sample-poll-${id}`, kind: payload.poll ? 'poll' : 'message', chat_id: payload.chat_id, direction: 'out', status: 'sent',
      ...(payload.poll ? { poll: { question: payload.poll.question, options: payload.poll.options.map((text, i) => ({ id: `sample-option-${i}`, text, votes: 0, voters: [] })) } } : {}),
    } })
  } : undefined,
  geocodeFetch: mockPlanning ? async () => Response.json({ features: [{ geometry: { type: 'Point', coordinates: [-122.342, 47.609] }, properties: { name: 'Pike Place Market', city: 'Seattle', country: 'United States', osm_type: 'N', osm_id: 123 } }] }) : undefined,
  sendZeroSettleAcknowledgment: mockLinks ? async (chatId, text) => {
    console.log('SAMPLE_ZEROSETTLE_ACK ' + JSON.stringify({ chatId, text }))
    return { state: 'sent', providerMessageId: 90001 }
  } : undefined,
})
const doc = new Y.Doc()
const provider = new WebsocketProvider(`ws://127.0.0.1:${srv.port}/sync`, `wander-${PILOT_TRIP_ID}`, doc, {
  WebSocketPolyfill: WebSocket, disableBc: true,
})
await new Promise((resolve) => provider.once('synced', resolve))
if (!doc.getMap('meta').get('seeded')) seedPilotTrip(doc)
// Wait for the relay to apply the fixture before advertising readiness.
const deadline = Date.now() + 5000
while (!srv.rooms.get(`wander-${PILOT_TRIP_ID}`)?.doc.getMap('meta').get('seeded')) {
  if (Date.now() > deadline) throw new Error('Pilot seed did not reach relay')
  await new Promise((resolve) => setTimeout(resolve, 25))
}
provider.destroy()
doc.destroy()
console.log(`Pilot ready: http://127.0.0.1:${srv.port}/t/${PILOT_TRIP_ID}`)
