// Only signs with the fictional local-test secret; never calls ZeroSettle.
import { sampleEvent, signSample } from '../server/zerosettle-sample.mjs'
const event = sampleEvent('alice')
event.message.id = Number(process.argv[3] ?? 72001)
if (!Number.isSafeInteger(event.message.id) || event.message.id <= 0) throw new Error('Use a positive safe sample message ID')
event.message.text = process.argv[2] ?? 'Nice place by the river https://example.com/stay'
const raw = JSON.stringify(event)
const port = Number(process.env.PILOT_PORT ?? 1246)
const response = await fetch(`http://127.0.0.1:${port}/webhooks/zerosettle`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-zerosettle-signature': signSample(raw) }, body: raw,
})
console.log(response.status, await response.text())
if (!response.ok) process.exitCode = 1
