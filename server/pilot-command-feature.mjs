// The existing saved-claim/text-transport policy, shared by new deterministic features.
import { createDeliveryQueue } from './zerosettle-delivery.mjs'
import { sendZeroSettleText } from './zerosettle-ack.mjs'
export const FEATURE_DELIVERIES = ['pilotBudgetDeliveries', 'pilotPlaceDeliveries', 'pilotWandaClarificationDeliveries']
export function recoverFeatureDeliveries(doc) {
  for (const map of FEATURE_DELIVERIES) for (const [id, job] of doc.getMap(map)) if (job.state === 'sending') doc.getMap(map).set(id, { ...job, state: 'uncertain', reason: 'relay_restarted' })
  for (const [id, work] of doc.getMap('pilotPlaceLookups')) if (work.state === 'running') doc.getMap('pilotPlaceLookups').set(id, { ...work, state: 'pending' })
}
export function createCommandFeature({ config, enabled, mapName, commandName, roomForTrip, persistNow, fetchImpl, apply }) {
  if (!enabled) return null
  if (!config.apiKey) throw new Error(`${commandName} requires a server API key`)
  const room = () => roomForTrip(config.tripId)
  const usable = (r) => r && r.doc.getMap('meta').get('seeded') && !r.doc.getMap('meta').get('deleted')
  const recordReply = (doc, id, reply) => {
    const jobs = doc.getMap(mapName)
    if (!jobs.has(id)) jobs.set(id, { state: 'pending', chatId: config.chatId, reply, createdAt: Date.now() })
  }
  const queue = createDeliveryQueue({
    enabled: true,
    pending: () => { const r = room(); return usable(r) ? [...r.doc.getMap(mapName)].filter(([, j]) => j.state === 'pending' && j.chatId === config.chatId).map(([id]) => id) : [] },
    claim: (id) => {
      const r = room(); if (!usable(r)) return null
      const jobs = r.doc.getMap(mapName), job = jobs.get(id)
      if (job?.state !== 'pending' || job.chatId !== config.chatId) return null
      jobs.set(id, { ...job, state: 'sending', attemptedAt: Date.now() })
      if (!persistNow(r)) { jobs.set(id, job); return null }
      return job
    },
    deliver: (job, signal) => sendZeroSettleText({ config, chatId: job.chatId, text: job.reply, signal, fetchImpl }),
    finish: (id, outcome) => {
      const r = room(); if (!usable(r)) return
      const jobs = r.doc.getMap(mapName), job = jobs.get(id)
      if (!job || !['sending', 'uncertain'].includes(job.state)) return
      jobs.set(id, { ...job, ...outcome, finishedAt: Date.now() }); persistNow(r)
    },
  })
  function command(context, parsed, onApplied) {
    const r = room(); if (!usable(r)) return { status: 404, body: { error: 'trip not found' } }
    const { messageId, senderId, text } = context, doc = r.doc, receipts = doc.getMap('pilotMessageReceipts'), previous = receipts.get(messageId)
    if (previous && (previous.senderId !== senderId || previous.text !== text)) return { status: 409, body: { error: 'messageId already used with different content' } }
    if (!previous) doc.transact(() => {
      const name = doc.getMap('members').get(senderId)?.name ?? context.senderHandle ?? 'Trip tester'
      const outcome = apply(doc, { ...context, name }, parsed)
      receipts.set(messageId, { senderId, text, command: commandName, outcome })
      if (!outcome.deferReply) recordReply(doc, messageId, outcome.reply)
      if (outcome.changed) doc.getArray('feed').push([{ id: 'f_' + messageId, by: name, byId: senderId, text: outcome.reply, ts: Date.now() }])
      onApplied?.(doc)
    }, commandName)
    if (!persistNow(r)) return { status: 503, body: { error: 'could not persist; retry the same message' } }
    return { status: 200, body: { ok: true, duplicate: !!previous, messageId, ...receipts.get(messageId).outcome } }
  }
  return { command, recordReply, resume: queue.resume, close: queue.close, room, usable }
}
