// Real signed hosted ingress, disposable local PostgreSQL-compatible storage, and mocked iMessage.
// --real replaces only the Anthropic mock with the live API, using synthetic messages.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { startHosted } from '../server/hosted/service.mjs'
import { claudeConfig, HAIKU_MODEL } from '../server/wanda-claude.mjs'
import { signSample, sampleConfig } from '../server/zerosettle-sample.mjs'
import { zeroSettleSenderId } from '../server/zerosettle-protocol.mjs'

const real = process.argv.includes('--real')
if (real && !process.env.ANTHROPIC_API_KEY) throw Error('Provide ANTHROPIC_API_KEY through the environment')
const root = await mkdtemp(join(tmpdir(), 'wander-haiku-'))
const port = process.env.WANDER_CLAUDE_TEST_PORT ?? '1259'
const origin = 'http://127.0.0.1:' + port
const group = 'iMessage;+;chatHaikuSynthetic'
const sam = '+12025550109',
  maya = '+12025550108',
  alex = '+12025550107',
  otherAlex = '+12025550106'
const settings = claudeConfig(process.env)
const env = {
  PORT: port,
  WANDER_PUBLIC_ORIGIN: origin,
  WANDER_CLAIM_KEY: 's'.repeat(48),
  ZEROSETTLE_ENABLED: '1',
  ZEROSETTLE_WEBHOOK_SECRET: sampleConfig.webhookSecret,
  ZEROSETTLE_API_KEY: 'sample-messaging-only',
  ZEROSETTLE_ACCOUNT_SCOPE: 'synthetic-haiku',
  ZEROSETTLE_ALLOWED_GROUPS: group,
  ZEROSETTLE_POLLS: '1',
  ZEROSETTLE_LISTS: '1',
  ZEROSETTLE_BUDGETS: '1',
  ZEROSETTLE_PLACES: '1',
  ZEROSETTLE_ACKNOWLEDGMENTS: '1',
  ZEROSETTLE_TESTER_NAMES: JSON.stringify({
    [sam]: 'Sam',
    [maya]: 'Maya',
    [alex]: 'Alex Reed',
    [otherAlex]: 'Alex Lee',
  }),
  ANTHROPIC_API_KEY: real ? process.env.ANTHROPIC_API_KEY : 'sample-only',
  WANDA_CLAUDE_ENABLED: '1',
  WANDA_CLAUDE_MODEL: settings.model,
  WANDA_CLAUDE_TIMEOUT_MS: real ? '20000' : '250',
}
const sends = [],
  calls = [],
  logs = [],
  decisions = []
let offset = 0,
  service,
  browser
const message = (kind, fields = {}) => ({ kind, ...fields })
const modelResponse = (decision) =>
  Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(decision) }] })
async function provider(url, init) {
  if (url.endsWith('/groups'))
    return Response.json({ groups: [{ chat_id: group, participants: [sam, maya, alex, otherAlex] }] })
  assert.ok(url.endsWith('/send'))
  const out = JSON.parse(init.body),
    id = 5000 + sends.length
  sends.push({ id, ...out })
  return Response.json({
    id,
    status: 'message_sent',
    ok: true,
    record: {
      guid: 'test-guid-' + id,
      ...(out.poll
        ? { poll: { options: out.poll.options.map((text, i) => ({ id: String(i), text })) } }
        : {}),
    },
  })
}

async function model(url, init) {
  assert.equal(url, 'https://api.anthropic.com/v1/messages')
  const body = JSON.parse(init.body)
  assert.equal(body.output_config.format.type, 'json_schema')
  const input = JSON.parse(body.messages[0].content)
  calls.push(input)
  if (real) {
    const response = await fetch(url, init)
    if (response.ok) {
      const data = await response.clone().json()
      const value = data.content.find((part) => part.type === 'text')?.text
      if (value) decisions.push(JSON.parse(value))
    }
    return response
  }
  const text = input.text
  if (/ride on my card/i.test(text)) {
    await delay(100)
    return modelResponse(message('expense', { title: 'Ride', amount: '60', split: ['Alex Reed', 'Maya'] }))
  }
  if (/slow expense/i.test(text)) {
    await delay(2000, undefined, { signal: init.signal })
    throw Error('timeout did not abort the mock')
  }
  if (/invalid expense/i.test(text)) return modelResponse({ kind: 'expense', amount: 8, payer: 'Sam' })
  if (/rate-limited expense/i.test(text)) return new Response(null, { status: 429 })
  if (/Seahawks/i.test(text))
    return modelResponse(message('clarify', { reason: 'trip_idea', title: 'Seahawks game' }))
  if (/NFL|joke/i.test(text)) return modelResponse(message('none'))
  if (/two changes/.test(text)) return modelResponse(message('clarify', { reason: 'multiple' }))
  if (/85\.\.43/.test(text)) return modelResponse(message('expense', { title: 'Dinner', amount: '85.43' }))
  if (/log dinner/i.test(text))
    return modelResponse(message('clarify', { reason: 'amount', draft: 'expense', title: 'Dinner' }))
  if (/^USD 8\.01$/.test(text)) return modelResponse(message('expense', { title: 'Dinner', amount: '8.01' }))
  if (/€85\s+USD/.test(text)) return modelResponse(message('expense', { title: 'Late dinner', amount: '85' }))
  if (text === 'USD' && input.followUp?.questionType === 'currency')
    return modelResponse(message('expense', { title: 'Late dinner', amount: '85' }))
  if (/make it \$92/.test(text)) return modelResponse(message('correct', { amount: '92' }))
  if (/fronted/.test(text))
    return modelResponse(
      message('expense', {
        title: 'Taxi',
        amount: '12',
        split: [text.includes('Taylor') ? 'Taylor' : 'Alex'],
      }),
    )
  if (/how much have we spent/i.test(text)) return modelResponse(message('spending'))
  if (/vote between/i.test(text))
    return modelResponse(message('poll', { question: 'Where should we go?', items: ['Market', 'Museum'] }))
  if (/budget .*trip/i.test(text)) return modelResponse(message('personal_budget', { amount: '700' }))
  if (/add sunscreen/i.test(text))
    return modelResponse(message('list_add', { title: 'Packing', items: ['Sunscreen'] }))
  if (/save a place/i.test(text)) return modelResponse(message('place', { title: 'Market' }))
  if (/trip link/i.test(text)) return modelResponse(message('board'))
  if (/save this link/i.test(text)) return modelResponse(message('link'))
  if (/book us/i.test(text)) return modelResponse(message('unsupported'))
  if (/if I paid/.test(text)) return modelResponse(message('hypothetical', { title: 'Dinner', amount: '85' }))
  if (/can we do/.test(text)) return modelResponse(message('group_target', { amount: '800' }))
  if (/went on my card|payed/i.test(text))
    return modelResponse(message('expense', { title: 'Dinner', amount: '85.43', currency: 'USD' }))
  return modelResponse(message('none'))
}
const start = () =>
  startHosted({
    env,
    testDir: join(root, 'db'),
    fetch: provider,
    claudeFetch: model,
    claudeLogger: (event) => logs.push(event),
    host: '127.0.0.1',
    clock: () => Date.now() + offset,
  })
async function waitFor(test, label) {
  const until = Date.now() + (real ? 26000 : 6000)
  while (Date.now() < until) {
    const found = await test()
    if (found) return found
    await delay(20)
  }
  throw Error('Timed out waiting for ' + label)
}
const post = async (
  id,
  text,
  { who = sam, reply, event = 'message.received', direction = 'in', invalid = false } = {},
) => {
  const raw = JSON.stringify({
    event,
    message: {
      id,
      chat_id: group,
      text,
      handle: who,
      direction,
      status: direction === 'in' ? 'received' : 'sent',
      kind: 'message',
      ...(reply ? { reply_to: { id: reply } } : {}),
    },
  })
  return fetch(origin + '/webhooks/zerosettle', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zerosettle-signature': invalid ? 'invalid' : signSample(raw),
    },
    body: raw,
  })
}
const sent = (start, matcher) =>
  waitFor(() => sends.slice(start).find((out) => matcher.test(out.text ?? '')), String(matcher))
try {
  service = await start()
  const diag = await (await fetch(origin + '/health/wanda')).json()
  assert.equal(diag.interpreter, 'claude')
  assert.equal(diag.model, settings.model || HAIKU_MODEL)
  await post(1, '@Wanda start a trip Synthetic Haiku demo')
  const opening = await sent(0, /active trip: /)
  const invite = new URL(opening.text.split(' ').at(-1))
  const api = origin + '/api/trip/' + invite.pathname.split('/').at(-1) + '/'
  const headers = { origin, 'x-wander-invite': invite.hash.slice(1) }
  browser = await chromium.launch()
  const ctx = await browser.newContext(),
    page = await ctx.newPage()
  const preview = await (await ctx.request.get(api + 'invite', { headers })).json()
  const picker = preview.members.find((member) => member.masked.endsWith(sam.slice(-4))).id
  const request = (action, data) => ctx.request.post(api + action, { headers, data })
  const challenge = await (await request('challenge', { picker })).json()
  const code = sends.findLast((out) => out.to === sam).text.match(/\d{6}/)[0]
  assert.equal((await request('verify', { challenge: challenge.challenge, code })).status(), 200)
  assert.equal((await request('name', { name: 'Sam' })).status(), 200)
  const canvas = async () => await (await ctx.request.get(api + 'canvas')).json()
  await page.goto(invite.href)
  await page.getByText('Live', { exact: true }).waitFor()
  await page.getByRole('link', { name: 'expenses' }).click()

  const run = async (id, text, matcher, options) => {
    const count = sends.length,
      before = logs.length
    assert.equal((await (await post(id, text, options)).json()).accepted, true)
    return matcher ? sent(count, matcher) : waitFor(() => logs[before], text)
  }
  const dinner = 'Wanda, dinner came to USD $85.43 and it went on my card.'
  const dinnerReply = await run(2, dinner, /Logged \$85\.43 for Dinner.*all 4 trip members/i)
  await page.getByText('Dinner', { exact: false }).first().waitFor()
  await page.getByText('USD 85.43', { exact: true }).first().waitFor()
  assert.equal((await canvas()).expenses.filter((expense) => expense.minor === 8543).length, 1)
  assert.equal((await (await post(2, dinner)).json()).duplicate, true)
  const beforeTrivia = sends.length
  await run(3, '@Wanda what about the Seahawks?', /thinking of adding .*Seahawks.*to the trip/i)
  const ignored = await run(4, '@Wanda name three NFL players')
  assert.equal(ignored.outcome, 'silent')
  assert.equal(sends.length, beforeTrivia + 1)
  assert.equal((await canvas()).expenses.length, 1)
  if (real) {
    assert.deepEqual(
      decisions.map((value) => value.kind),
      ['expense', 'clarify', 'none'],
    )
    assert.equal(decisions[0].amount, '85.43')
    assert.equal(decisions[1].reason, 'trip_idea')
    assert.equal(calls.length, 3)
    console.log(
      JSON.stringify({
        model: diag.model,
        decisions: decisions.map((value) => value.kind),
        visibleExpenseMinor: 8543,
        replayCount: 1,
      }),
    )
  } else {
    const initial = calls.length
    await post(5, '@Wanda help')
    await post(6, '@Wanda expense USD 8..43 | Dinner')
    await post(7, 'The Seahawks looked good last night.')
    await post(8, '@Wanda joke', { event: 'message.sent', direction: 'out' })
    assert.equal((await post(9, dinner, { who: '+12025550119' })).status, 403)
    assert.equal((await post(10, dinner, { invalid: true })).status, 401)
    await post(11, 'I vote for Lisbon')
    const cardsBeforeLink = (await canvas()).cards.length
    await post(12, 'Look at https://example.com/ordinary')
    assert.equal(calls.length, initial)
    assert.equal((await canvas()).cards.length, cardsBeforeLink + 1)
    await run(13, 'Wanda, I paid 85..43 for dinner', /exact amount/)
    await run(14, 'Wanda, book us four tickets for Saturday.', /save a ticket link/)
    await run(
      15,
      'Wanda, if I paid $85 for dinner, what would that be each?',
      /would be USD 21.25 each for 4/,
    )
    await run(16, 'Wanda, how much have we spent?', /Recorded spending: USD 85.43/)
    assert.equal((await canvas()).expenses.length, 1)
    await run(41, 'Wanda I fronted $12 for a taxi. Taylor is splitting it.', /couldn’t find “Taylor”/)
    assert.equal((await canvas()).expenses.length, 1)
    const ambiguous = await run(17, 'Wanda I fronted $12 for a taxi. Alex is splitting it.', /Which “Alex”/)
    const callBeforeChoice = calls.length
    await post(18, '1', { who: maya, reply: ambiguous.id })
    assert.equal(calls.length, callBeforeChoice)
    await post(19, '1', { reply: ambiguous.id })
    await sent(0, /Logged \$12.00 for Taxi/)
    const taxi = (await canvas()).expenses.find((item) => item.title === 'Taxi')
    assert.equal(taxi.splitAmong.length, 1)
    assert.ok([zeroSettleSenderId(alex), zeroSettleSenderId(otherAlex)].includes(taxi.splitAmong[0]))
    await run(20, 'Wanda, i payed USD $85.43 for diner', /Logged \$85.43 for Dinner/i)
    await run(21, 'Wanda, can we vote between the market and the museum?')
    await waitFor(() => sends.find((out) => out.poll?.options?.includes('Museum')), 'poll sent')
    await post(22, '@Wanda list Packing | Hat')
    await run(23, 'Wanda, add sunscreen to Packing', /Added 1 item to Packing/i)
    assert.ok(
      (await canvas()).cards
        .find((card) => card.title === 'Packing')
        .items.some((item) => item.text === 'Sunscreen'),
    )
    await run(24, 'Wanda, save a place for this https://maps.app.goo.gl/sample', /saved map link/i)
    await run(25, 'Wanda, send the trip link again.', /active trip:/)
    await run(26, 'Wanda, save this link https://example.com/once', /Saved to your trip board/)
    await post(26, 'Wanda, save this link https://example.com/once')
    assert.equal((await canvas()).cards.filter((card) => card.url === 'https://example.com/once').length, 1)
    await run(27, 'Wanda, can we do $800?', /personal budget, the group target, or an expense/i)
    assert.equal((await canvas()).budget.target, null)
    await run(28, 'Wanda, two changes: add a hat and log dinner', /Which change should I make first/)
    await run(29, 'Wanda, actually make it $92', /Which expense or budget/)
    await run(30, 'Wanda, actually make it $92', /Updated Dinner to USD 92.00/, { reply: dinnerReply.id })
    await run(31, 'Wanda, I paid €85 USD for dinner', /Which currency/)
    await run(32, 'Wanda, USD', /Logged \$85.00 for Late dinner/i)
    await run(33, 'Wanda, slow expense I paid $12 for lunch', /Try @Wanda expense/)
    assert.equal(logs.at(-1).category, 'timeout')
    await run(34, 'Wanda, invalid expense I paid $12 for lunch', /Try @Wanda expense/)
    assert.equal(logs.at(-1).category, 'invalid_output')
    await run(42, 'Wanda, rate-limited expense I paid $12 for lunch', /Try @Wanda expense/)
    assert.equal(logs.at(-1).category, 'rate_limited')
    const jokeCount = sends.length
    await run(43, 'Wanda, tell me a joke.')
    assert.equal(sends.length, jokeCount)
    const beforeBurst = calls.length
    const ride = 'Wanda, the ride on my card cost $60. Alex Reed and Maya are splitting it.'
    const burst = await Promise.all([post(35, ride), post(35, ride), post(35, ride)])
    const states = await Promise.all(burst.map((response) => response.json()))
    assert.equal(states.filter((body) => body.accepted).length, 1)
    await sent(0, /Logged \$60.00 for Ride.*2 selected members/)
    assert.equal(calls.length, beforeBurst + 1)
    assert.equal(
      (await canvas()).expenses.find((item) => item.title === 'Ride').paidBy,
      zeroSettleSenderId(sam),
    )
    const actualShares = (await canvas()).expenses.find((item) => item.title === 'Ride').splitAmong
    assert.deepEqual(new Set(actualShares), new Set([zeroSettleSenderId(alex), zeroSettleSenderId(maya)]))
    await run(36, 'Wanda, tell me a joke. 202 555 0199 code 123456 https://example.org/join/trip#secret')
    assert.ok(!/0199|123456|#secret/.test(calls.at(-1).text))
    const expired = await run(37, 'Wanda, log dinner', /exact amount/)
    offset += 16 * 60 * 1000
    const beforeExpiry = calls.length
    await post(38, 'USD 8.01', { reply: expired.id })
    assert.equal(calls.length, beforeExpiry)
    await service.close()
    env.WANDA_CLAUDE_DAILY_CAP = String(calls.length)
    service = await start()
    const beforeRestart = calls.length
    assert.equal((await (await post(35, ride)).json()).duplicate, true)
    assert.equal((await canvas()).expenses.filter((item) => item.title === 'Ride').length, 1)
    const afterCap = sends.length
    await post(39, 'Wanda I paid $11 for dinner')
    await sent(afterCap, /Try @Wanda expense/)
    assert.equal(calls.length, beforeRestart)
    assert.equal((await (await post(40, '@Wanda expense USD 11 | Exact dinner')).json()).changed, true)
    console.log(
      'Verified mock Haiku routing, exact bypass, silence, read-only totals and estimates, feature dispatch, privacy, clarification scope and expiry, replay, restart, timeout, invalid output and the persisted daily cap.',
    )
  }
} finally {
  await browser?.close()
  await service?.close()
  await rm(root, { recursive: true, force: true })
}
