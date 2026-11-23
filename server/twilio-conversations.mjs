import twilio from 'twilio'
import { destinationVote } from './vote-command.mjs'

export const CONVERSATIONS_PATH = '/webhooks/twilio/conversations'
const sid = (prefix, value) => typeof value === 'string' && new RegExp(`^${prefix}[a-fA-F0-9]{32}$`).test(value)
const safeTrip = (value) => typeof value === 'string' && /^[a-zA-Z0-9_~.-]{1,120}$/.test(value)

export function conversationsConfig(env = process.env) {
  if (env.TWILIO_CONVERSATIONS_ENABLED !== '1') return null
  return {
    authToken: env.TWILIO_AUTH_TOKEN,
    accountSid: env.TWILIO_ACCOUNT_SID,
    webhookUrl: env.TWILIO_CONVERSATIONS_WEBHOOK_URL,
    conversationTrips: JSON.parse(env.TWILIO_CONVERSATION_TRIPS ?? '{}'),
    ownAuthor: env.TWILIO_WANDER_AUTHOR ?? 'wander',
    ownParticipantSid: env.TWILIO_WANDER_PARTICIPANT_SID,
    boardBaseUrl: env.WANDER_BOARD_BASE_URL,
    replies: env.TWILIO_BOARD_REPLIES ?? 'dry-run',
  }
}

export function createConversationsAdapter({ config = conversationsConfig(), executePilotMessage, sendReply }) {
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  if (!config) return async (_req, res) => json(res, 404, { error: 'not found' })
  const c = config
  const url = new URL(c.webhookUrl)
  const boardUrl = new URL(c.boardBaseUrl)
  if (!c.authToken || !sid('AC', c.accountSid) || !c.ownAuthor ||
      !['http:', 'https:'].includes(url.protocol) || url.pathname !== CONVERSATIONS_PATH || url.hash || url.username || url.password ||
      !['http:', 'https:'].includes(boardUrl.protocol) || boardUrl.username || boardUrl.password ||
      !['dry-run', 'live'].includes(c.replies) ||
      !c.conversationTrips || Array.isArray(c.conversationTrips) || typeof c.conversationTrips !== 'object' ||
      !Object.entries(c.conversationTrips).every(([key, value]) => sid('CH', key) && safeTrip(value)) ||
      (c.ownParticipantSid && !sid('MB', c.ownParticipantSid))) {
    throw new Error('Invalid Twilio Conversations configuration')
  }
  // Use a fixed external URL, never Host/X-Forwarded-* supplied by the request.
  const target = url.pathname + url.search
  const client = c.replies === 'live' && !sendReply ? twilio(c.accountSid, c.authToken, { timeout: 10000, autoRetry: false }) : null
  const send = sendReply ?? ((conversationSid, body) => client.conversations.v1.conversations(conversationSid).messages.create({
    author: c.ownAuthor, body, attributes: JSON.stringify({ wander: true }),
  }))

  return async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'use POST' })
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') {
      return json(res, 415, { error: 'use application/x-www-form-urlencoded' })
    }
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 65536) return json(res, 413, { error: 'body too large' })
      chunks.push(chunk)
    }
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
    // Twilio sends scalar form fields. Reject duplicates to prevent validation/processing ambiguity.
    const params = Object.create(null)
    for (const [key, value] of form) {
      if (Object.hasOwn(params, key)) return json(res, 400, { error: 'duplicate form field' })
      params[key] = value
    }
    const signature = req.headers['x-twilio-signature']
    if (req.url !== target || typeof signature !== 'string' || !twilio.validateRequest(c.authToken, signature, c.webhookUrl, params)) {
      return json(res, 403, { error: 'invalid Twilio signature' })
    }
    // No room is opened or changed until the complete request has authenticated.
    const ignore = (reason) => json(res, 200, { ok: true, ignored: reason })
    if (params.AccountSid && params.AccountSid !== c.accountSid) return json(res, 403, { error: 'wrong account' })
    if (params.EventType !== 'onMessageAdded') return ignore('event type')
    if (!Object.hasOwn(c.conversationTrips, params.ConversationSid ?? '')) return ignore('unmapped conversation')
    if (params.Author === c.ownAuthor || (c.ownParticipantSid && params.ParticipantSid === c.ownParticipantSid)) return ignore('own message')
    if (!sid('MB', params.ParticipantSid)) return ignore('no participant voter')
    if (!sid('IM', params.MessageSid)) return json(res, 400, { error: 'invalid MessageSid' })
    const text = params.Body ?? ''
    const board = text.trim().toLowerCase() === 'board'
    if (!board && !destinationVote(text)) return ignore('unsupported command')
    const tripId = c.conversationTrips[params.ConversationSid]
    const response = executePilotMessage({ messageId: params.MessageSid, tripId, senderId: params.ParticipantSid, text }, { allowBoard: true })
    if (response.status !== 200 || !board || response.body.duplicate) return json(res, response.status, response.body)
    const link = new URL(`/t/${encodeURIComponent(tripId)}`, c.boardBaseUrl).href
    if (c.replies === 'dry-run') return json(res, 200, { ...response.body, reply: { mode: 'dry-run', body: link } })
    // Receipt was saved before dispatch: at most one send attempt per board command.
    // On an ambiguous send failure, a new explicit `board` message can request another link.
    try {
      await send(params.ConversationSid, link)
      return json(res, 200, { ...response.body, reply: { mode: 'live', sent: true } })
    } catch {
      return json(res, 502, { ...response.body, error: 'board reply failed; send a new board command to retry' })
    }
  }
}
