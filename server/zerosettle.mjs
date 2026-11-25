import { wandaCommandText } from './wanda-command.mjs'
import crypto from 'node:crypto'
import { providerMessageId, normalizeHandle, zeroSettleSenderId } from './zerosettle-protocol.mjs'
import { parseWandaBudget } from './zerosettle-budget.mjs'
import { parseWandaPlace } from './zerosettle-places.mjs'
import { parseWandaList } from './zerosettle-lists.mjs'
import { parseWandaPoll } from './zerosettle-polls.mjs'
import { destinationVote } from './vote-command.mjs'
import { linkMessage } from './link-message.mjs'
import { createAcknowledgmentQueue } from './zerosettle-ack.mjs'
import { exactWithModel, modelReplay } from './wanda-model-route.mjs'
import './zerosettle-env.mjs'

export { normalizeHandle, zeroSettleSenderId } from './zerosettle-protocol.mjs'
export const ZEROSETTLE_PATH = '/webhooks/zerosettle'
export function testerNames(value = {}) {
  let mapping
  try { mapping = typeof value === 'string' ? JSON.parse(value) : value } catch { throw new Error('ZEROSETTLE_TESTER_NAMES must be a JSON object') }
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || Object.entries(mapping).some(([handle, name]) => !normalizeHandle(handle) || typeof name !== 'string' || !name.trim() || name.length > 80 || [...name].some((c) => c.charCodeAt(0) < 32))) throw new Error('Invalid ZEROSETTLE_TESTER_NAMES mapping')
  return Object.fromEntries(Object.entries(mapping).map(([handle, name]) => [normalizeHandle(handle), name.trim()]))
}
export function zeroSettleConfig(env = process.env) {
  if (env.ZEROSETTLE_ENABLED !== '1') return null
  return {
    webhookSecret: env.ZEROSETTLE_WEBHOOK_SECRET,
    chatId: env.ZEROSETTLE_CHAT_ID,
    testers: (env.ZEROSETTLE_TESTER_HANDLES ?? '').split(',').map((v) => v.trim()).filter(Boolean),
    tripId: env.ZEROSETTLE_TRIP_ID,
    testerNames: testerNames(env.ZEROSETTLE_TESTER_NAMES ?? {}),
    acknowledgments: env.ZEROSETTLE_ACKNOWLEDGMENTS === '1',
    polls: env.ZEROSETTLE_POLLS === '1',
    lists: env.ZEROSETTLE_LISTS === '1',
    budgets: env.ZEROSETTLE_BUDGETS === '1',
    places: env.ZEROSETTLE_PLACES === '1',
    geocoderEnabled: env.ZEROSETTLE_GEOCODER_ENABLED === '1',
    geocoderUrl: env.ZEROSETTLE_GEOCODER_URL,
    geocoderUserAgent: env.ZEROSETTLE_GEOCODER_USER_AGENT,
    geocoderIntervalMs: env.ZEROSETTLE_GEOCODER_INTERVAL_MS,
    geocoderDailyLimit: env.ZEROSETTLE_GEOCODER_DAILY_LIMIT,
    boardBaseUrl: env.ZEROSETTLE_BOARD_BASE_URL || (() => { try { return new URL(env.ZEROSETTLE_WEBHOOK_URL).origin } catch { return undefined } })(),
    apiKey: env.ZEROSETTLE_API_KEY,
  }
}
export function verifyZeroSettleSignature(secret, header, rawBody, now = Date.now()) {
  if (typeof header !== 'string') return false
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header)
  if (!match) return false
  const timestamp = Number(match[1])
  if (!Number.isSafeInteger(timestamp) || Math.abs(now / 1000 - timestamp) > 300) return false
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest()
  return crypto.timingSafeEqual(expected, Buffer.from(match[2], 'hex'))
}
export function createZeroSettleAdapter({ config = zeroSettleConfig(), executePilotMessage, ackStore, sendAcknowledgment, fetchImpl, polls, lists, budgets, places, language, model }) {
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  if (!config) return async (_req, res) => json(res, 404, { error: 'not found' })
  if (typeof config.webhookSecret !== 'string' || !config.webhookSecret.trim() ||
      typeof config.chatId !== 'string' || !config.chatId.startsWith('iMessage;+;') ||
      config.chatId.length > 128 || /\s/.test(config.chatId) || config.chatId.length <= 11 ||
      typeof config.tripId !== 'string' || !/^[a-zA-Z0-9_~.-]{1,120}$/.test(config.tripId) ||
      !Array.isArray(config.testers) || !config.testers.length || config.testers.some((v) => !normalizeHandle(v))) {
    throw new Error('ZeroSettle requires a webhook secret, one iMessage group chat ID, tester handles, and a trip ID')
  }
  if (config.acknowledgments && !sendAcknowledgment && !config.apiKey) throw new Error('ZeroSettle acknowledgments require a server API key')
  testerNames(config.testerNames) // fail closed, without echoing private values
  const testers = new Set(config.testers.map(normalizeHandle))
  const queue = createAcknowledgmentQueue({
    config, send: sendAcknowledgment, fetchImpl,
    pending: () => ackStore.pending(config.tripId, config.chatId),
    claim: (id) => ackStore.claim(config.tripId, id, config.chatId),
    finish: (id, outcome) => ackStore.finish(config.tripId, id, outcome),
  })
  places?.setFallback((context) => {
    const response = executePilotMessage({ ...context, tripId: config.tripId }, { allowLinks: true, deferredComment: context.deferredComment, deferredCommentId: context.deferredCommentId, acknowledgment: { enabled: !!config.acknowledgments, chatId: config.chatId } })
    if (response.status === 200 && response.body.cardIds?.length) queue.enqueue(response.body.messageId)
    return response
  })
  const handler = async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'use POST' })
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return json(res, 415, { error: 'use application/json' })
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 65536) return json(res, 413, { error: 'body too large' })
      chunks.push(chunk)
    }
    const raw = Buffer.concat(chunks)
    if (!verifyZeroSettleSignature(config.webhookSecret, req.headers['x-zerosettle-signature'], raw)) {
      return json(res, 401, { error: 'invalid ZeroSettle signature' })
    }
    let payload
    try { payload = JSON.parse(raw.toString('utf8')) } catch { return json(res, 400, { error: 'invalid JSON' }) }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json(res, 400, { error: 'invalid event' })
    const ignore = (reason) => json(res, 200, { ok: true, ignored: reason })
    // Signed test events are acknowledged but cannot create votes. Outbound/system events never enter the handler.
    if (payload.test === true) return ignore('test event')
    if (!['message.received', 'poll.voted'].includes(payload.event)) return ignore('event type')
    const message = payload.message
    if (!message || typeof message !== 'object' || Array.isArray(message)) return json(res, 400, { error: 'message required' })
    if (message.direction !== 'in' || message.status !== 'received') return ignore('not inbound')
    if (payload.event === 'poll.voted' ? message.kind !== 'poll_vote' : (message.kind !== undefined && message.kind !== 'message')) return ignore('not text')
    if (message.service !== undefined && message.service !== 'iMessage') return ignore('not iMessage')
    if (message.chat_id !== config.chatId) return json(res, 403, { error: 'group not allowed' })
    const handle = normalizeHandle(message.handle)
    if (!handle || !(config.memberAllowed ? config.memberAllowed(handle) : testers.has(handle))) return json(res, 403, { error: 'tester not allowed' })
    if (payload.event === 'poll.voted') {
      if (!polls) return ignore('native polls disabled')
      const response = polls.vote(message, zeroSettleSenderId(handle))
      return json(res, response.status, response.body)
    }
    const id = providerMessageId(message.id)
    if (!id || typeof message.text !== 'string') return json(res, 400, { error: 'message ID and text required' })
    const replyId = providerMessageId(message.reply_to?.id)
    const replyGuid = typeof message.reply_to?.guid === 'string' && message.reply_to.guid.length <= 200 ? message.reply_to.guid : undefined
    const context = {
      messageId: `zerosettle.message.received.${id}`, providerId: id, chatId: config.chatId, timestamp: message.ts_ms,
      senderId: zeroSettleSenderId(handle), senderHandle: handle, text: message.text,
      replyTo: replyId || replyGuid ? { id: replyId, guid: replyGuid } : undefined,
    }
    const duplicate = modelReplay(language?.room()?.doc, context)
    if (duplicate) return json(res, duplicate.status, duplicate.body)
    const command = wandaCommandText(message.text)
    const parsed = linkMessage(message.text)
    const timestamp = Number.isSafeInteger(message.ts_ms) && message.ts_ms > 0 ? message.ts_ms : null
    const passive = () => {
      if (!destinationVote(message.text) && !parsed.voteText && !parsed.urls.length && !timestamp)
        return { status: 200, body: { ok: true, ignored: 'unsupported command' } }
      const response = executePilotMessage({ ...context, tripId: config.tripId }, {
        allowLinks: true,
        correlation: timestamp ? { providerId: id, chatId: config.chatId, timestamp } : undefined,
        acknowledgment: { enabled: !!config.acknowledgments, chatId: config.chatId },
      })
      if (response.status === 200 && response.body.cardIds?.length) queue.enqueue(response.body.messageId)
      return response
    }
    const candidates = {
      budget: parseWandaBudget(message.text), place: parseWandaPlace(message.text),
      list: parseWandaList(message.text), poll: parseWandaPoll(message.text),
    }
    const { budget: budgetCommand, place, list: listCommand, poll: pollCommand } = model
      ? exactWithModel(command, candidates) : candidates
    let placeCommand = place ?? places?.selection(context)
    if (places?.observe(context) === false) return json(res, 503, { error: 'could not persist; retry' })
    // Hold a link only when it can pair with a map request. Addressed model actions remain exclusive.
    if (!budgetCommand && (placeCommand || !command)) {
      const split = places?.split(context, placeCommand)
      if (split?.response) return json(res, split.response.status, split.response.body)
      placeCommand = split?.parsed ?? placeCommand
    }

    const features = { list: lists, poll: polls, budget: budgets, place: places, clarify: language }
    const dispatch = (route, interpreted = false) => {
      if (!route) return parsed.urls.length ? passive() : { status: 200, body: { ok: true } }
      if (route.feature === 'link') return passive()
      if (route.feature === 'board') return config.boardCommand(context)
      const feature = features[route.feature]
      const unavailable = route.needs ?? route.feature
      if (!feature || (route.needs && !features[route.needs])) {
        return { status: 200, body: { ok: true, ignored: { poll: 'native polls disabled', list: 'checklist commands disabled',
          budget: 'budget commands disabled', place: 'place commands disabled' }[unavailable] ?? 'commands disabled' } }
      }
      const response = feature.command(context, route.parsed, interpreted ? (doc) => language.record(doc, context, route) : undefined)
      if (response.status === 200) feature.resume()
      return response
    }
    const exact = budgetCommand ? { feature: 'budget', parsed: budgetCommand }
      : placeCommand ? { feature: 'place', parsed: placeCommand }
        : pollCommand ? { feature: 'poll', parsed: pollCommand }
          : listCommand && (model || listCommand.action !== 'add' || listCommand.valid ||
            message.text.includes('|') || /^add\s+to\b/i.test(command)) ? { feature: 'list', parsed: listCommand }
            : null
    if (exact) {
      const response = dispatch(exact)
      return json(res, response.status, response.body)
    }
    const natural = language?.route(context, { allowFresh: !model, modelEnabled: !!model })
    if (natural?.ignore) return ignore('unmatched clarification')
    if (natural?.feature) {
      const response = dispatch(natural, true)
      return json(res, response.status, response.body)
    }
    if (model && !parsed.voteText && !destinationVote(message.text)) {
      const accepted = model.accept(context, natural?.pendingModel, (route) => dispatch(route, true))
      if (accepted) return json(res, accepted.status, accepted.body)
    }
    const bareAddChatter = language && listCommand && !/^\s*@/u.test(message.text)
    const response = listCommand && !bareAddChatter ? dispatch({ feature: 'list', parsed: listCommand }) : passive()
    return json(res, response.status, response.body)
  }
  handler.resume = () => { queue.resume(); polls?.resume(); lists?.resume(); budgets?.resume(); places?.resume(); language?.resume() }
  handler.close = () => { model?.close(); queue.close(); polls?.close(); lists?.close(); budgets?.close(); places?.close(); language?.close() }
  return handler
}
