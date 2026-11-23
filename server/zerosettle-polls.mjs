import { wandaCommandText } from './wanda-command.mjs'
import { placementWidgets } from '../src/collab/checklists.mjs'
import crypto from 'node:crypto'
import { placeWidget } from '../src/collab/placement.mjs'
import { createDeliveryQueue } from './zerosettle-delivery.mjs'
import { providerMessageId, normalizeHandle, zeroSettleSenderId } from './zerosettle-protocol.mjs'

export const POLL_USAGE = 'Use @Wanda poll Question? | Option 1 | Option 2 (2–12 different options; question ≤300 characters, options ≤150).'
const chars = (s) => [...s].length
export function parseWandaPoll(text) {
  const command = wandaCommandText(text)
  if (command === null || !/^poll\b/i.test(command)) return null
  const parts = command.replace(/^poll\b/i, '').split('|').map((v) => v.trim())
  const [question, ...options] = parts
  const valid = question.length > 0 && chars(question) <= 300 && options.length >= 2 && options.length <= 12 &&
    options.every((v) => chars(v) >= 1 && chars(v) <= 150) && new Set(options.map((v) => v.toLowerCase())).size === options.length
  return valid ? { valid: true, question, options } : { valid: false }
}
const keyFor = (id) => 'zerosettle.poll.voted.' + id
const token = (v) => typeof v === 'string' && v.length > 0 && v.length <= 128 && !/\s|\|/.test(v)
function optionMapping(record, original) {
  const options = record?.poll?.options
  if (!Array.isArray(options) || options.length !== original.options.length || !options.every((o) => token(o.id) && typeof o.text === 'string')) return null
  if (new Set(options.map((o) => o.id)).size !== options.length) return null
  const mapping = Object.create(null)
  for (const own of original.options) {
    const matches = options.filter((o) => o.text.trim().toLowerCase() === own.text.toLowerCase())
    if (matches.length !== 1) return null
    mapping[matches[0].id] = own.id
  }
  return mapping
}
export function pollBoardUrl(config, widgetId) {
  try {
    const url = new URL(config.boardBaseUrl)
    // Never text someone an operator's loopback/LAN board address. Public HTTPS only.
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !url.hostname.includes('.') || /^\d|localhost$|\.local$/i.test(url.hostname)) return null
    return `${url.origin}/t/${encodeURIComponent(config.tripId)}#widget-${widgetId}`
  } catch { return null }
}
function status(doc, job) {
  if (job.kind !== 'poll') return
  const widgets = doc.getMap('widgets'), w = widgets.get(job.widgetId)
  if (w?.type === 'vote' && w.nativePoll?.commandId === job.commandId) widgets.set(w.id, {
    ...w, nativePoll: { ...w.nativePoll, state: job.state, reason: job.reason },
  })
}
export function recoverPollDeliveries(doc) {
  for (const [id, job] of doc.getMap('pilotPollDeliveries')) if (job.state === 'sending') {
    const next = { ...job, state: 'uncertain', reason: 'relay_restarted' }
    doc.getMap('pilotPollDeliveries').set(id, next)
    status(doc, next)
  }
}

export function createPilotPolls({ config, roomForTrip, persistNow, fetchImpl = fetch }) {
  if (!config?.polls) return null
  if (!config.apiKey) throw new Error('ZeroSettle native polls require a server API key')
  const allowedSenders = new Set(config.testers.map((handle) => zeroSettleSenderId(normalizeHandle(handle))))
  const room = () => roomForTrip(config.tripId)
  const usable = (r) => r && r.doc.getMap('meta').get('seeded') && !r.doc.getMap('meta').get('deleted')
  const response = (status, body) => ({ status, body })
  function saveReply(doc, commandId, text) {
    const id = `reply.${commandId}`
    if (!doc.getMap('pilotPollDeliveries').has(id)) doc.getMap('pilotPollDeliveries').set(id, {
      commandId, kind: 'text', chatId: config.chatId, state: 'pending', payload: { chat_id: config.chatId, text }, createdAt: Date.now(),
    })
  }
  const queue = createDeliveryQueue({
    enabled: true,
    pending: () => { const r = room(); return usable(r) ? [...r.doc.getMap('pilotPollDeliveries')].filter(([, j]) => j.state === 'pending' && j.chatId === config.chatId).map(([id]) => id) : [] },
    claim: (id) => {
      const r = room(); if (!usable(r)) return null
      const jobs = r.doc.getMap('pilotPollDeliveries'), job = jobs.get(id)
      if (job?.state !== 'pending' || job.chatId !== config.chatId) return null
      r.doc.transact(() => { const next = { ...job, state: 'sending', attemptedAt: Date.now() }; jobs.set(id, next); status(r.doc, next) })
      if (!persistNow(r)) { r.doc.transact(() => { jobs.set(id, job); status(r.doc, job) }); return null }
      return job
    },
    deliver: async (job, abortSignal) => {
      const signal = AbortSignal.any([abortSignal, AbortSignal.timeout(90000)])
      const headers = { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }
      const res = await fetchImpl('https://portal.zerosettle.io/api/imessage/send', {
        method: 'POST', headers, body: JSON.stringify(job.payload), redirect: 'error', signal,
      })
      if (res.status >= 400 && res.status < 500 && res.status !== 408) {
        let code
        try { code = (await res.json()).error?.code } catch { /* safe fixed fallback */ }
        return { state: 'failed', reason: code === 'poll_unsupported' ? 'poll_unsupported' : `http_${res.status}` }
      }
      if (!res.ok) return { state: 'uncertain', reason: 'upstream_error' }
      const data = await res.json(), id = providerMessageId(data.id)
      if (data.ok !== true || data.status !== 'message_sent' || !id) return { state: 'uncertain', reason: 'unconfirmed_response' }
      if (job.kind === 'text') return { state: 'sent', providerMessageId: id }
      const original = room()?.doc.getMap('pilotNativePolls').get(job.commandId)
      let record = data.record
      if (!record?.poll?.options) {
        // Safe read only: never repeat the accepted POST just to recover its identifiers.
        try {
          const res = await fetchImpl(`https://portal.zerosettle.io/api/imessage/messages/${id}/poll`, { headers, redirect: 'error', signal })
          if (res.ok) { const data = await res.json(); record = data.record ?? data }
        } catch { /* retained accepted ID can also be resolved by a later signed vote snapshot */ }
      }
      const mapping = original && optionMapping(record, original)
      if (!mapping || providerMessageId(record?.id) !== id || record.kind !== 'poll' ||
        (record.direction !== undefined && record.direction !== 'out') || (record.status !== undefined && record.status !== 'sent') ||
        (record.chat_id !== undefined && record.chat_id !== config.chatId)) return { state: 'uncertain', reason: 'mapping_unavailable', providerMessageId: id }
      return { state: 'sent', providerMessageId: id, providerGuid: token(record.guid) ? record.guid : undefined, optionMap: mapping }
    },
    finish: (id, outcome) => {
      const r = room(); if (!usable(r)) return
      const jobs = r.doc.getMap('pilotPollDeliveries'), job = jobs.get(id)
      if (!job || !['sending', 'uncertain'].includes(job.state)) return
      r.doc.transact(() => {
        const next = { ...job, ...outcome, reason: outcome.reason, finishedAt: Date.now() }; jobs.set(id, next); status(r.doc, next)
        if (job.kind === 'poll') {
          const polls = r.doc.getMap('pilotNativePolls'), poll = polls.get(job.commandId)
          polls.set(job.commandId, { ...poll, ...outcome })
          if (outcome.state === 'failed') {
            const link = pollBoardUrl(config, job.widgetId)
            const text = outcome.reason === 'poll_unsupported' ? 'This line cannot send native polls yet.' : 'Could not send the native poll.'
            saveReply(r.doc, job.commandId, text + (link ? ` Vote on the board: ${link}` : ' Your poll is saved on the Wander board.'))
          }
          drainVotes(r)
        }
      })
      persistNow(r) // on failure the durable sending claim prevents another attempt after restart
      queue.resume()
    },
  })

  function command({ messageId, senderId, text }, parsed) {
    const r = room(); if (!usable(r)) return response(404, { error: 'trip not found' })
    const doc = r.doc, receipts = doc.getMap('pilotMessageReceipts'), previous = receipts.get(messageId)
    if (previous && (previous.senderId !== senderId || previous.text !== text)) return response(409, { error: 'messageId already used with different content' })
    if (!previous) doc.transact(() => {
      const receipt = { senderId, text, command: 'wanda-poll' }
      if (!parsed.valid) saveReply(doc, messageId, POLL_USAGE)
      else {
        const widgetId = 'w_poll_' + crypto.createHash('sha256').update(messageId).digest('hex').slice(0, 24)
        const options = parsed.options.map((text, i) => ({ id: `${widgetId}_o${i}`, text }))
        const widgets = doc.getMap('widgets')
        widgets.set(widgetId, { id: widgetId, type: 'vote', ...placeWidget(placementWidgets(doc, widgets.values()), { type: 'vote', options, nativePoll: { commandId: messageId, state: 'pending' } }),
          z: Math.max(0, ...[...widgets.values()].map((w) => w.z)) + 1, question: parsed.question, options,
          eligible: config.testers.length, closes: 'no deadline', nativePoll: { commandId: messageId, state: 'pending' },
        })
        doc.getMap('pilotNativePolls').set(messageId, { commandId: messageId, widgetId, chatId: config.chatId, question: parsed.question, options, senderId, state: 'pending' })
        doc.getMap('pilotPollDeliveries').set(`native.${messageId}`, { commandId: messageId, widgetId, kind: 'poll', chatId: config.chatId,
          payload: { chat_id: config.chatId, poll: { question: parsed.question, options: parsed.options } }, state: 'pending', createdAt: Date.now() })
        receipt.pollWidgetId = widgetId
      }
      receipts.set(messageId, receipt)
    }, 'wanda-poll-command')
    if (!persistNow(r)) return response(503, { error: 'could not persist; retry the same message' })
    const receipt = receipts.get(messageId)
    // Enqueue only after the ingress response is ready; no upstream call is awaited by the webhook.
    return response(200, { ok: true, duplicate: !!previous, tripId: config.tripId, messageId, command: 'wanda-poll', ...(receipt.pollWidgetId ? { pollWidgetId: receipt.pollWidgetId } : { usage: POLL_USAGE }) })
  }
  function findPoll(doc, message) {
    const targetId = providerMessageId(message.target_id), guid = token(message.target_guid) ? message.target_guid : null
    return [...doc.getMap('pilotNativePolls').values()].find((p) => p.chatId === config.chatId &&
      ((targetId && p.providerMessageId === targetId) || (guid && p.providerGuid === guid)) &&
      (!targetId || !p.providerMessageId || p.providerMessageId === targetId) && (!guid || !p.providerGuid || p.providerGuid === guid))
  }
  function applyVote(r, key, entry) {
    const doc = r.doc, message = entry.message, poll = findPoll(doc, message)
    if (!poll) return false
    let mapping = poll.optionMap
    if (!mapping && message.poll) {
      mapping = optionMapping({ poll: message.poll }, poll)
      if (mapping) {
        const jobs = doc.getMap('pilotPollDeliveries'), id = `native.${poll.commandId}`, job = jobs.get(id)
        doc.getMap('pilotNativePolls').set(poll.commandId, { ...poll, optionMap: mapping, ...(job?.reason === 'mapping_unavailable' && job.providerMessageId ? { state: 'sent', reason: undefined } : {}) })
        if (job?.reason === 'mapping_unavailable' && job.providerMessageId) {
          const next = { ...job, state: 'sent', reason: undefined, optionMap: mapping }
          jobs.set(id, next); status(doc, next)
        }
      }
    }
    if (!mapping) return false
    const selected = message.vote.option_ids
    if (selected.some((id) => !Object.hasOwn(mapping, id))) {
      doc.getMap('pilotPollEvents').set(key, { ...entry, state: 'invalid_options' }); return true
    }
    const versions = doc.getMap('pilotPollVoterVersions'), versionKey = `${poll.widgetId}|${entry.senderId}`, version = versions.get(versionKey)
    const ts = message.ts_ms, id = providerMessageId(message.id)
    if (version && (ts < version.ts || (ts === version.ts && BigInt(id) <= BigInt(version.id)))) {
      doc.getMap('pilotPollEvents').set(key, { ...entry, state: 'stale' }); return true
    }
    const w = doc.getMap('widgets').get(poll.widgetId)
    if (w?.type === 'vote' && w.nativePoll?.commandId === poll.commandId) {
      const votes = doc.getMap('votes')
      for (const optionId of Object.values(mapping)) votes.delete(`${poll.widgetId}|${optionId}|${entry.senderId}`)
      for (const optionId of selected.map((id) => mapping[id])) if (w.options.some((o) => o.id === optionId)) votes.set(`${poll.widgetId}|${optionId}|${entry.senderId}`, ts)
    }
    versions.set(versionKey, { ts, id })
    doc.getMap('pilotPollEvents').set(key, { ...entry, state: w?.type === 'vote' ? 'applied' : 'deleted_card' })
    return true
  }
  function drainVotes(r) {
    const pending = r.doc.getMap('pilotPendingPollVotes')
    for (const [key, entry] of pending) {
      if (Date.now() - entry.arrivedAt > 600000 || !(config.authorizedSenderId ? config.authorizedSenderId(entry.senderId) : allowedSenders.has(entry.senderId)) || applyVote(r, key, entry)) pending.delete(key)
    }
  }
  function vote(message, senderId) {
    const id = providerMessageId(message.id)
    if (!id || (!providerMessageId(message.target_id) && !token(message.target_guid)) ||
      !Number.isSafeInteger(message.ts_ms) || message.ts_ms <= 0 || !Array.isArray(message.vote?.option_ids) ||
      message.vote.option_ids.length > 12 || !message.vote.option_ids.every(token) || new Set(message.vote.option_ids).size !== message.vote.option_ids.length) return response(400, { error: 'invalid poll vote' })
    const r = room(); if (!usable(r)) return response(404, { error: 'trip not found' })
    const events = r.doc.getMap('pilotPollEvents'), key = keyFor(id), previous = events.get(key)
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ senderId, targetId: message.target_id, targetGuid: message.target_guid, ts: message.ts_ms, options: message.vote.option_ids })).digest('hex')
    if (previous && previous.fingerprint !== fingerprint) return response(409, { error: 'messageId already used with different vote' })
    if (!previous) r.doc.transact(() => {
      const entry = { senderId, fingerprint, message: { id, target_id: message.target_id, target_guid: message.target_guid, ts_ms: message.ts_ms, vote: message.vote, poll: message.poll }, arrivedAt: Date.now(), state: 'waiting' }
      drainVotes(r)
      if (!applyVote(r, key, entry)) {
        // Buffer only while an originating native send is in flight, or its known-ID mapping is incomplete.
        const inFlight = [...r.doc.getMap('pilotPollDeliveries').values()].some((j) => j.kind === 'poll' && j.state === 'sending')
        if (inFlight || findPoll(r.doc, message)) {
          const pending = r.doc.getMap('pilotPendingPollVotes'); pending.set(key, entry)
          while (pending.size > 128) pending.delete(pending.keys().next().value)
          events.set(key, entry)
        } else events.set(key, { ...entry, state: 'unknown_poll' })
      }
      drainVotes(r)
    }, 'wanda-poll-vote')
    if (!persistNow(r)) return response(503, { error: 'could not persist; retry the same event' })
    return response(200, { ok: true, duplicate: !!previous, event: 'poll.voted', state: events.get(key).state })
  }
  return { command, vote, resume: queue.resume, close: queue.close }
}
