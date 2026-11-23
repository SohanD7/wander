import { createDeliveryQueue } from './zerosettle-delivery.mjs'

// Ordinary text sends have no documented provider idempotency key.
export function createAcknowledgmentQueue({ config, claim, finish, pending, send, fetchImpl = fetch }) {
  return createDeliveryQueue({ enabled: config.acknowledgments, claim, finish, pending, deliver: (item, signal) => send ? send(item.chatId, 'Saved to your trip board.') : sendZeroSettleText({ config, chatId: item.chatId, text: 'Saved to your trip board.', signal, fetchImpl }) })
}

export async function sendZeroSettleText({ config, chatId, to, text, signal, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl('https://portal.zerosettle.io/api/imessage/send', {
      method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(to ? { to } : { chat_id: chatId }), text }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
    })
    if (response.status >= 400 && response.status < 500 && response.status !== 408) {
      return { state: 'failed', reason: `http_${response.status}` }
    }
    if (!response.ok) return { state: 'uncertain', reason: 'upstream_error' }
    const result = await response.json()
    if (result.ok !== true || result.status !== 'message_sent' || !Number.isSafeInteger(result.id) || result.id <= 0) {
      return { state: 'uncertain', reason: 'unconfirmed_response' }
    }
    return { state: 'sent', providerMessageId: result.id, ...(typeof result.record?.guid === 'string' && result.record.guid.length <= 200 ? { providerGuid: result.record.guid } : {}) }
  } catch { return { state: 'uncertain', reason: 'network_or_timeout' } }
}
