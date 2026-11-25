import { wandaCommandText } from './wanda-command.mjs'
import { linkMessage } from './link-message.mjs'
import { parseWandaList, listKey } from './zerosettle-lists.mjs'
import { parseWandaPlace } from './zerosettle-places.mjs'
import { parseWandaPoll } from './zerosettle-polls.mjs'
import { tripMoney } from './zerosettle-budget.mjs'
import { CURRENCY_PRECISION } from '../src/collab/pilot-budget.mjs'
import { modelText } from './wanda-claude.mjs'

const moneyKinds = ['expense', 'personal_budget', 'group_target', 'hypothetical', 'correct']
const budgetKinds = [
  ...moneyKinds,
  'spending',
  'budget_summary',
  'group_summary',
  'target_summary',
  'budget_clear',
]
const listActions = { list_create: 'list', list_add: 'add', list_done: 'done', list_undo: 'undo' }
const currencies = new RegExp('\\b(' + Object.keys(CURRENCY_PRECISION).join('|') + ')\\b', 'gi')
const singleLine = (s) =>
  typeof s === 'string' && !!s.trim() && !s.includes('|') && [...s].every((c) => c.charCodeAt(0) >= 32)
const reply = (text, prompt) => ({ feature: 'clarify', parsed: { reply: text, prompt } })
const clarify = (reason, title) =>
  ({
    amount: 'How much was it? Reply with the exact amount, like USD 85.43.',
    currency: 'Which currency should I use? Reply with the code, like USD.',
    kind: 'Is that your personal budget, the group target, or an expense?',
    reference: 'Which expense or budget should I update?',
    split: 'Who should split it? Reply with their names as shown on the trip.',
    trip_idea:
      title && singleLine(title)
        ? `Are you thinking of adding ${/\b(?:game|match|show|concert)$/i.test(title) && !/^(?:a|an|the) /i.test(title) ? 'a ' : ''}${title.slice(0, 100)} to the trip?`
        : 'Is that something you’d like to add to the trip?',
    multiple: 'Which change should I make first?',
    details: 'Could you include the trip details you want me to use?',
  })[reason]
const noQuotes = (text) => text.replace(/^\s*>.*$/gm, '').replace(/“[^”]*”|"[^"]*"/g, '')
const hypothetical = (text) =>
  /\b(?:what if|hypothetically|if (?:i|we|you) (?:paid|pay|spent|spend|covered|cover|put)|what would (?:that|it) be)\b/i.test(
    text,
  )
const writes = new Set([
  'expense',
  'correct',
  'personal_budget',
  'budget_clear',
  'group_target',
  'poll',
  'list_create',
  'list_add',
  'list_done',
  'list_undo',
  'list_rename',
  'poll_rename',
  'place',
  'link',
])
export const modelWrites = (kind) => writes.has(kind)

export function capabilities(config) {
  return [
    'board',
    'link',
    ...(config.polls ? ['poll'] : []),
    ...(config.lists ? ['checklist'] : []),
    ...(config.places ? ['place'] : []),
    ...(config.budgets ? ['expense', 'budget', 'spending', 'hypothetical'] : []),
  ]
}

export function modelFailure(context, pending, config) {
  const text = wandaCommandText(context.text) ?? context.text
  // Failure help is intentionally narrower than the set of messages sent to the model.
  if (
    config.budgets &&
    (pending?.prompt.draft === 'expense' ||
      /\b(?:expense|log (?:a |my )?(?:purchase|expense)|i (?:paid|spent|covered|fronted|payed)\b)/i.test(
        text,
      ))
  )
    return reply('I couldn’t read that just now. Try @Wanda expense USD 85.43 | Dinner.')
  if (config.budgets && /\bbudget\b/i.test(text))
    return reply('I couldn’t read that just now. Try @Wanda budget USD 600 per person.')
  if (config.polls && /\b(?:poll|vote (?:on|between))\b/i.test(text))
    return reply('I couldn’t read that just now. Try @Wanda poll Where? | Market | Museum.')
  if (config.lists && /\b(?:packing list|checklist)\b/i.test(text))
    return reply('I couldn’t read that just now. Try @Wanda list Packing | Sunscreen.')
  if (config.places && /\b(?:save a place|save this place|add a place)\b/i.test(text))
    return reply('I couldn’t read that just now. Try @Wanda place Pike Place Market, Seattle.')
  if (/\b(?:board|trip|canvas) link\b/i.test(text))
    return reply('I couldn’t read that just now. Try @Wanda board.')
  return null
}

function moneyEvidence(doc, decision, text, pending, previousCurrency) {
  const original = pending?.prompt.original ?? ''
  const sources = [noQuotes(text), noQuotes(original)]
  const amounts = sources.flatMap((source) =>
    (source.match(/[+-]?\d[\d.,]*/g) ?? []).map((token) => token.replace(/[.,]$/, '')),
  )
  const amount = decision.amount
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d+)?$/.test(amount ?? '') || !amounts.includes(amount))
    return { reason: 'amount' }
  const explicit = (source) => [
    ...(source.match(currencies) ?? []).map((code) => code.toUpperCase()),
    ...(source.includes('€') ? ['EUR'] : []),
    ...(source.includes('£') ? ['GBP'] : []),
  ]
  // An answer to a currency question supersedes the ambiguous currency in the original.
  const codes = [
    ...new Set(
      pending?.prompt.reason === 'currency' && explicit(sources[0]).length
        ? explicit(sources[0])
        : sources.flatMap(explicit),
    ),
  ]
  const selected = codes[0] ?? previousCurrency
  let symbol = sources.some((s) => s.includes('$')) ? '$' : undefined
  if (pending?.prompt.reason === 'currency' && codes.length === 1) symbol = undefined
  if (codes.length > 1 || (sources.some((s) => s.includes('¥')) && !['JPY', 'CNY'].includes(selected)))
    return { reason: 'currency' }
  if (hypothetical(sources.join(' ')) && decision.kind === 'expense') return { reason: 'kind' }
  const value = tripMoney(doc, { amount, currency: selected, symbol })
  if (value.error) return { reason: value.error === 'currency' ? 'currency' : 'amount' }
  return { amount, ...value, symbol }
}

export function decisionRoute({ decision, context, doc, config, language, pending, reference }) {
  const { kind, reason, title, newTitle, items = [], split } = decision
  const text = ((pending?.answer ?? wandaCommandText(context.text)) || context.text).trim()
  const original = modelText([pending?.prompt.original, text].filter(Boolean).join('\n'))
  const ask = (reason, draft) => reply(clarify(reason, title), { type: 'model', reason, original, draft })
  const feature = budgetKinds.includes(kind)
    ? 'budgets'
    : kind.startsWith('list_')
      ? 'lists'
      : kind === 'poll' || kind === 'poll_rename'
        ? 'polls'
        : kind === 'place' || kind === 'places'
          ? 'places'
          : null
  if (feature && !config[feature])
    return reply('That trip feature is turned off. See @Wanda help for what’s available.')
  if (kind === 'none') return null
  if (kind === 'clarify') return ask(reason, decision.draft ?? pending?.prompt.draft)
  if (kind === 'unsupported') return reply('I can save a ticket link or help plan the outing on the board.')
  if (
    modelWrites(kind) &&
    /\b(?:and(?: also)?|then|also)\s+(?:log|record|add|set|clear|remove|create|start|rename|save|vote)\b/i.test(
      noQuotes(text),
    )
  )
    return ask('multiple')
  // A clarification cannot be used to turn a different request into a write.
  const draft = pending?.prompt.draft
  if (
    draft &&
    kind !== draft &&
    (moneyKinds.includes(kind) || feature === 'lists' || feature === 'polls' || kind === 'place')
  )
    return ask('details', draft)
  if (kind === 'board') return { feature: 'board' }
  if (kind === 'link') return linkMessage(context.text).urls.length ? { feature: 'link' } : ask('details')
  if (kind === 'place' || kind === 'places') {
    const url = linkMessage(context.text).urls[0]
    const target = url ?? title
    if (kind === 'place' && !singleLine(target)) return ask('details')
    return {
      feature: 'place',
      parsed: parseWandaPlace(kind === 'places' ? '@Wanda places' : '@Wanda place ' + target),
    }
  }
  if (kind === 'poll') {
    if (![decision.question, ...items].every(singleLine)) return ask('details')
    const poll = parseWandaPoll('@Wanda poll ' + [decision.question, ...items].join(' | '))
    return { feature: 'poll', parsed: poll }
  }
  if (kind === 'list_rename' || kind === 'poll_rename') {
    if (![title, newTitle].every(singleLine)) return ask('details')
    return language.resolve(
      doc,
      { kind: 'rename', widgetType: kind === 'list_rename' ? 'checklist' : 'vote', title, newTitle },
      context,
    )
  }
  if (Object.hasOwn(listActions, kind)) {
    if (![title, ...items].every(singleLine)) return ask('details')
    const command = listActions[kind]
    const parsed = parseWandaList(
      '@Wanda ' + (command === 'add' ? 'add to' : command) + ' ' + [title, ...items].join(' | '),
    )
    if (!parsed.valid) return { feature: 'list', parsed }
    return language.resolve(doc, { kind: 'list', ...parsed }, context)
  }
  if (!moneyKinds.includes(kind)) {
    const action = {
      spending: 'spending',
      budget_summary: 'summary',
      group_summary: 'group-summary',
      target_summary: 'target',
      budget_clear: 'clear',
    }[kind]
    return action ? { feature: 'budget', parsed: { action } } : null
  }
  if (kind === 'group_target' && /\b(?:maybe|what if|should we|could we (?:do|aim)|can we do)\b/i.test(text))
    return ask('kind')
  const ownReference = reference?.senderId === context.senderId ? reference?.outcome : null
  const expenses = doc.getMap('expenses')
  let expense = ownReference?.expenseId && expenses.get(ownReference.expenseId)
  if (kind === 'correct' && !expense && pending?.prompt.reason === 'reference') {
    const matches = [...expenses.values()].filter(
      (e) => e.paidBy === context.senderId && listKey(e.title) === listKey(text),
    )
    if (matches.length === 1) expense = matches[0]
  }
  const personal =
    kind === 'correct' &&
    (ownReference?.budgetAction === 'set' ||
      (pending?.prompt.reason === 'reference' && /^(?:my|personal) budget[.!]?$/i.test(text)))
  if (kind === 'correct' && !personal && expense?.paidBy !== context.senderId) return ask('reference', kind)
  const existingCurrency =
    expense?.currency ??
    (expense ? 'USD' : personal ? doc.getMap('budgetPreferences').get(context.senderId)?.currency : undefined)
  const value = moneyEvidence(doc, decision, text, pending, existingCurrency)
  if (value.reason) return ask(value.reason, kind)
  if (kind === 'correct') {
    if (personal) return { feature: 'budget', parsed: { action: 'set', ...value } }
    return { feature: 'budget', parsed: { action: 'correct', expenseId: expense.id, ...value } }
  }
  if (kind === 'group_target' || kind === 'personal_budget')
    return { feature: 'budget', parsed: { action: kind === 'group_target' ? 'set-target' : 'set', ...value } }
  if (kind === 'expense' && !singleLine(title)) return ask('details', kind)
  // Treat a named sharing clause as a requirement even when the model omits the split field.
  const explicitSplit =
    /\b(?:split(?:ting)? (?:it |the (?:ride|cost|bill) )?(?:with|between|among)|(?:are|is) (?:splitting|sharing))\b/i.test(
      original,
    )
  if (
    split?.some(
      (name) =>
        !singleLine(name) ||
        !(
          original.toLowerCase().includes(name.toLowerCase()) ||
          (/^(?:me|myself)$/i.test(name) &&
            /\b(?:i (?:am |will )?(?:split|share)|we (?:are |will )?(?:split|share))\b/i.test(original))
        ),
    )
  )
    return ask('split', kind)
  return language.resolve(
    doc,
    {
      kind: 'budget',
      parsed: {
        action: kind,
        ...value,
        label: title,
        conversational: true,
        model: true,
        split: split ?? (explicitSplit ? [] : undefined),
      },
    },
    context,
  )
}
