// Server-side operator helper. Never outputs API keys, signing secrets or raw API responses.
import fs from 'node:fs'
import { loadZeroSettleEnv, privateZeroSettleConfig } from '../server/zerosettle-env.mjs'

loadZeroSettleEnv()
const API = 'https://portal.zerosettle.io'
const command = process.argv[2]
const allowed = ['line', 'groups', 'inbound', 'diagnose', 'register', 'managed-by-api']
if (!allowed.includes(command)) {
  console.error('Usage: node scripts/zerosettle.mjs line|groups|inbound|diagnose|register|managed-by-api')
  process.exit(1)
}
if (!process.env.ZEROSETTLE_API_KEY) {
  console.error('ZEROSETTLE_API_KEY is missing from the server environment/private key file')
  process.exit(1)
}
try {
  let route = '/api/imessage/line'
  const init = { headers: { Authorization: `Bearer ${process.env.ZEROSETTLE_API_KEY}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000), redirect: 'error' }
  if (command === 'groups') route = '/api/imessage/groups'
  if (command === 'inbound') route = '/api/imessage/messages?after_id=0&limit=100'
  if (command === 'diagnose') route = '/api/imessage/agent'
  if (command === 'managed-by-api') {
    route = '/api/imessage/agent'
    if (process.env.ZEROSETTLE_LINE_ID) route += `?line=${encodeURIComponent(process.env.ZEROSETTLE_LINE_ID)}`
    init.method = 'PUT'
    init.body = JSON.stringify({ managed_by: 'api' })
  }
  if (command === 'register') {
    let url
    try { url = new URL(process.env.ZEROSETTLE_WEBHOOK_URL) } catch { throw new Error('Set ZEROSETTLE_WEBHOOK_URL to the public HTTPS receiver URL') }
    if (url.protocol !== 'https:' || url.pathname !== '/webhooks/zerosettle' || url.hash || url.username || url.password) {
      throw new Error('ZEROSETTLE_WEBHOOK_URL must be HTTPS with path /webhooks/zerosettle and no credentials/fragment')
    }
    // Prove we can save the one-time secret BEFORE rotating it at the provider.
    const fd = fs.openSync(privateZeroSettleConfig, 'a', 0o600)
    fs.closeSync(fd)
    fs.chmodSync(privateZeroSettleConfig, 0o600)
    route = '/api/imessage/webhook'
    init.method = 'PUT'
    init.body = JSON.stringify({ url: url.href, typing_events: false, optout_events: false, instant_typing: false })
  }
  let response
  try { response = await fetch(API + route, init) } catch {
    console.error('ZeroSettle request failed (network/timeout); no response contents logged')
    process.exit(1)
  }
  if (!response.ok) {
    console.error(`ZeroSettle HTTP ${response.status}${response.status === 402 ? ': activate the line subscription in the ZeroSettle console' : ''}`)
    process.exit(1)
  }
  const result = await response.json()
  if (command === 'register') {
    if (typeof result.secret !== 'string' || !result.secret) throw new Error('Registration returned no signing secret')
    const previous = fs.readFileSync(privateZeroSettleConfig, 'utf8')
    const rest = previous.split('\n').filter((line) => !/^\s*(?:export\s+)?ZEROSETTLE_(WEBHOOK_SECRET|WEBHOOK_URL)\s*=/.test(line)).join('\n').trimEnd()
    try {
      fs.writeFileSync(privateZeroSettleConfig, rest + `\nZEROSETTLE_WEBHOOK_SECRET=${JSON.stringify(result.secret)}\nZEROSETTLE_WEBHOOK_URL=${JSON.stringify(process.env.ZEROSETTLE_WEBHOOK_URL)}\n`, { mode: 0o600 })
    } catch {
      throw new Error('Webhook registered but secret could not be saved; fix private file permissions and re-register before receiving messages')
    }
    console.log('Webhook registered. One-time secret saved to ignored .env.zerosettle.local (mode 600); restart the relay to load it. Existing process environment takes precedence: unset ZEROSETTLE_WEBHOOK_SECRET before restarting if rotating.')
  } else if (command === 'diagnose') {
    console.log(JSON.stringify({ managed_by: result.managed_by }, null, 2))
    const messages = await fetch(API + '/api/imessage/messages?after_id=0&limit=100', { headers: init.headers, signal: AbortSignal.timeout(20000), redirect: 'error' })
    if (!messages.ok) { console.log(`Message metadata HTTP ${messages.status}`); process.exitCode = 1 }
    else {
      const history = await messages.json()
      console.log(JSON.stringify({ messageCount: history.messages?.length ?? 0, nextAfterId: history.next_after_id, metadata: (history.messages ?? []).map(({ id, direction, kind, handle, chat_id, service, ts_ms }) => ({ id, direction, kind, handle, chat_id, service, ts_ms })) }, null, 2))
    }
  } else if (command === 'inbound') {
    const testers = new Set((process.env.ZEROSETTLE_TESTER_HANDLES ?? '').split(',').map((v) => v.trim()))
    console.log(JSON.stringify({ messages: (result.messages ?? []).filter((m) => m.direction === 'in' && testers.has(m.handle)).map(({ id, handle, chat_id, service, ts_ms }) => ({ id, handle, chat_id, service, ts_ms })) }, null, 2))
  } else if (command === 'groups') {
    console.log(JSON.stringify({ groups: (result.groups ?? []).map(({ chat_id, name, participants }) => ({ chat_id, name, participants })) }, null, 2))
  } else if (command === 'line') {
    // Explicit allowlist of safe fields: API responses may add secret fields later.
    console.log(JSON.stringify({ handle: result.handle, active: result.active, group_chats: result.group_chats === true,
      webhookConfigured: !!result.webhook_url, webhookMatchesConfiguredUrl: result.webhook_url === process.env.ZEROSETTLE_WEBHOOK_URL, hasWebhookSecret: result.has_webhook_secret === true,
      lastDelivery: result.last_delivery ? { ok: result.last_delivery.ok, status: result.last_delivery.status_code, event: result.last_delivery.event, attempts: result.last_delivery.attempts } : null,
    }, null, 2))
  } else console.log('Line group is managed by API; hosted AI replies are disabled for that line group.')
} catch {
  console.error('ZeroSettle setup failed; check command, server environment and private-file permissions. No response or credential contents logged.')
  process.exitCode = 1
}
