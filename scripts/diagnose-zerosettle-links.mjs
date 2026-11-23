// Read-only structural diagnostics: never print credentials, message bodies, URL paths/queries or media bytes.
import crypto from 'node:crypto'
import '../server/zerosettle-env.mjs'
import { linkMessage } from '../server/link-message.mjs'
import { normalizeHandle } from '../server/zerosettle.mjs'
const env = process.env
if (!env.ZEROSETTLE_API_KEY || !env.ZEROSETTLE_CHAT_ID) throw new Error('Private ZeroSettle API/group configuration required')
try {
  const url = new URL('https://portal.zerosettle.io/api/imessage/messages')
  url.search = new URLSearchParams({ chat_id: env.ZEROSETTLE_CHAT_ID, after_id: '0', limit: '500' }).toString()
  const response = await fetch(url, { headers: { Authorization: `Bearer ${env.ZEROSETTLE_API_KEY}` }, redirect: 'error', signal: AbortSignal.timeout(20000) })
  if (!response.ok) { console.error(`ZeroSettle history HTTP ${response.status}`); process.exitCode = 1 }
  else {
    const data = await response.json()
    const allowed = new Set((env.ZEROSETTLE_TESTER_HANDLES ?? '').split(',').map((v) => normalizeHandle(v.trim())))
    const previous = new Map()
    const rows = (data.messages ?? []).filter((m) => m.chat_id === env.ZEROSETTLE_CHAT_ID && m.direction === 'in' && allowed.has(normalizeHandle(m.handle))).map((m) => {
      const parsed = linkMessage(m.text)
      const handle = normalizeHandle(m.handle)
      const last = previous.get(handle)
      previous.set(handle, m)
      const extraFields = []
      function fields(value, prefix = '', depth = 0) {
        if (!value || typeof value !== 'object' || depth > 4) return
        for (const [key, item] of Object.entries(value)) {
          const name = prefix + key
          if (typeof item === 'string' && /text|caption|title|description|url/i.test(key) && key !== 'text') extraFields.push({ field: name, length: item.length })
          if (item && typeof item === 'object') fields(item, name + '.', depth + 1)
        }
      }
      fields(m)
      return { id: m.id, senderTag: crypto.createHash('sha256').update(handle).digest('hex').slice(0, 8), kind: m.kind,
        ts_ms: m.ts_ms, fieldNames: Object.keys(m), sameGuidAsPrevious: !!(m.guid && last?.guid && m.guid === last.guid), replyToId: m.reply_to?.id, deltaFromPreviousSenderMs: last ? m.ts_ms - last.ts_ms : null,
        textLength: typeof m.text === 'string' ? m.text.length : null, linkCount: parsed.urls.length, commentLength: parsed.comment.length,
        vote: !!parsed.voteText, attachmentCount: Array.isArray(m.attachments) ? m.attachments.length : 0, extraFields }
    })
    console.log(JSON.stringify({ source: 'provider message history (same message object as webhooks)', rows }, null, 2))
  }
} catch { console.error('Cannot read ZeroSettle link diagnostics; no request/response contents logged.'); process.exitCode = 1 }
