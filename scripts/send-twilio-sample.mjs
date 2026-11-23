import { sampleConfig, sampleEvent, signSample } from '../server/twilio-sample.mjs'
const who = process.argv[2] ?? 'alice'
if (!['alice', 'bob', 'invalid', 'board'].includes(who)) throw new Error('Use alice, bob, invalid, or board')
const port = Number(process.env.PILOT_PORT ?? 1241)
const config = sampleConfig(port)
const event = sampleEvent(who === 'board' ? 'board' : who, who === 'board' ? 'board' : undefined)
const response = await fetch(config.webhookUrl, {
  method: 'POST', headers: {
    'content-type': 'application/x-www-form-urlencoded',
    'x-twilio-signature': who === 'invalid' ? 'invalid' : signSample(config, event),
  }, body: new URLSearchParams(event),
})
console.log(response.status, await response.text())
if (response.status !== (who === 'invalid' ? 403 : 200)) process.exitCode = 1
