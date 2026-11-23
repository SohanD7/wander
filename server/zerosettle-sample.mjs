// Fictional signed events for local verification; never contacts the provider.
import crypto from 'node:crypto'
export const sampleConfig = {
  webhookSecret: 'whsec_wander_sample_only', chatId: 'iMessage;+;chatWanderSample',
  testers: ['+12025550101', 'bob@example.com'], tripId: 'pilot-lisbon-demo',
}
export function sampleEvent(who = 'alice') {
  return { event: 'message.received', message: {
    id: who === 'alice' ? 71001 : 71002, kind: 'message', direction: 'in', status: 'received',
    handle: sampleConfig.testers[who === 'alice' ? 0 : 1], text: 'I vote for Lisbon', chat_id: sampleConfig.chatId,
  } }
}
export function signSample(raw) {
  const timestamp = Math.floor(Date.now() / 1000)
  return `t=${timestamp},v1=${crypto.createHmac('sha256', sampleConfig.webhookSecret).update(`${timestamp}.`).update(raw).digest('hex')}`
}
