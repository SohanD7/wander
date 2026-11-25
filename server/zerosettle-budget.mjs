import { wandaCommandText } from './wanda-command.mjs'
import { createCommandFeature } from './pilot-command-feature.mjs'
import {
  parseBudgetAmount,
  validBudget,
  budgetRows,
  budgetRanges,
  budgetSummary,
  amountText,
  tripBudgetTarget,
  tripFinances,
} from '../src/collab/pilot-budget.mjs'
import { placementWidgets } from '../src/collab/checklists.mjs'
import { placeWidget } from '../src/collab/placement.mjs'
import { saveExpense } from './hosted/workspace.mjs'
import { equalShares } from '../src/collab/pilot-budget.mjs'
const example = '@Wanda budget USD 600 per person'
const targetExample = '@Wanda budget target USD 500'
const expenseExample = '@Wanda expense USD 84.50 | Dinner'
const dollars = new Set(['USD', 'CAD', 'AUD', 'NZD'])
export function tripMoney(doc, parsed) {
  const currency =
    parsed.currency?.toUpperCase() ??
    tripFinances(doc.getMap('meta').toJSON(), [...doc.getMap('expenses').values()]).preferred
  if (!currency || (parsed.symbol && !dollars.has(currency))) return { error: 'currency' }
  return parseBudgetAmount(currency, parsed.amount)
}

export function parseWandaBudget(text) {
  const command = wandaCommandText(text)
  if (!command) return null
  if (/^expense(?:\s|$)/i.test(command)) {
    const parts =
      /^expense\s+(?:(?<currency>[a-z]{3})\s+)?(?<symbol>\$\s*)?(?<amount>\S+)\s*\|\s*(?<label>[^|\r\n]+)$/i.exec(
        command,
      )?.groups
    if (!parts || !parts.label.trim() || parts.label.trim().length > 200)
      return { error: `Include a positive amount and what it was for. Try ${expenseExample}` }
    return { action: 'expense', ...parts, label: parts.label.trim() }
  }
  if (!/^budget\b/i.test(command)) return null
  const rest = command.replace(/^budget\b/i, '').trim()
  if (/^(summary|clear)$/i.test(rest)) return { action: rest.toLowerCase() }
  if (/^target$/i.test(rest)) return { action: 'target' }
  if (/^target\b/i.test(rest)) {
    const match = /^target\s+([a-z]{3})\s+(\S+)$/i.exec(rest)
    const value = match && parseBudgetAmount(match[1], match[2])
    return value && !value.error
      ? { action: 'set-target', ...value }
      : { error: `Include a currency and a valid whole-trip amount. Try ${targetExample}` }
  }
  const match = /^([a-z]{3})\s+(\S+)\s+per\s+person$/i.exec(rest)
  if (!match) return { error: `Please include currency, amount and “per person”. Try ${example}.` }
  const amount = parseBudgetAmount(match[1], match[2])
  return amount.error ? amount : { action: 'set', ...amount }
}
export function ensureSummaryCard(doc, type, purpose, id) {
  migratePlanningCards(doc)
  const widgets = doc.getMap('widgets')
  const existing = [...widgets.values()].find((w) => w.type === type && w.purpose === purpose)
  if (existing) return existing.id
  // Avoid touching an unrelated legacy widget even if it happens to use our preferred ID.
  let selected = id
  while (widgets.has(selected)) selected += '_'
  const card = {
    id: selected,
    type,
    purpose,
    h: type === 'map' ? 456 : 336,
    ...(type === 'map' ? { place: '' } : {}),
    ...placeWidget(placementWidgets(doc, widgets.values()), { type, h: type === 'map' ? 456 : 336 }),
    z: Math.max(0, ...[...widgets.values()].map((w) => w.z)) + 1,
  }
  widgets.set(selected, card)
  return selected
}
export function createPilotBudgets(options) {
  const { config, hosted } = options
  const summaryCard = (doc) => {
    const canvasCard = hosted && [...doc.getMap('widgets').values()].find((w) => w.type === 'budget')
    return canvasCard?.id ?? ensureSummaryCard(doc, 'budget', 'preferences', 'w_budget_preferences')
  }
  return createCommandFeature({
    ...options,
    enabled: config?.budgets,
    mapName: 'pilotBudgetDeliveries',
    commandName: 'wanda-budget',
    apply: (doc, context, parsed) => {
      if (parsed.error) return { reply: parsed.error, changed: false }
      const meta = doc.getMap('meta')
      if (parsed.action === 'spending') {
        const { spending } = tripFinances(meta.toJSON(), [...doc.getMap('expenses').values()])
        return {
          changed: false,
          reply: spending.length
            ? 'Recorded spending: ' + spending.map(amountText).join(' · ') + '.'
            : 'No expenses have been recorded for this trip yet.',
        }
      }
      if (parsed.action === 'hypothetical') {
        const ids = parsed.splitAmong ?? [...doc.getMap('pilotRoster').keys()]
        const money = tripMoney(doc, parsed)
        if (money.error || !ids.length || (parsed.split !== undefined && !parsed.splitAmong?.length))
          return { changed: false, reply: 'Which currency and trip members should I use for the estimate?' }
        const shares = equalShares(money.minor, ids)
        const low = shares.at(-1).minor,
          high = shares[0].minor
        const each =
          low === high
            ? amountText({ ...money, minor: low })
            : amountText({ ...money, minor: low }) + '–' + amountText({ ...money, minor: high })
        return {
          changed: false,
          reply: `That would be ${each} each for ${shares.length} trip ${shares.length === 1 ? 'member' : 'members'}.`,
        }
      }
      if (parsed.action === 'correct') {
        const expense = doc.getMap('expenses').get(parsed.expenseId)
        if (expense?.paidBy !== context.senderId)
          return { changed: false, reply: 'Only the payer can correct that expense.' }
        if (!validBudget(parsed) || !parsed.minor)
          return { changed: false, reply: 'What is the exact expense amount?' }
        const expenseId = saveExpense(
          doc,
          { ...expense, currency: parsed.currency, minor: parsed.minor, splitAmong: undefined },
          expense,
        )
        return { changed: true, expenseId, reply: `Updated ${expense.title} to ${amountText(parsed)}.` }
      }
      if (parsed.action === 'target' || parsed.action === 'set-target') {
        if (parsed.action === 'set-target') {
          const previous = tripBudgetTarget(meta.toJSON())
          const { currency, minor } = parsed
          if (previous?.currency !== currency || previous.minor !== minor) {
            const widgetId = summaryCard(doc)
            meta.set('budgetTarget', { currency, minor })
            return {
              reply: `Trip budget target set to ${amountText(parsed)} for the group.`,
              changed: true,
              widgetId,
            }
          }
        }
        const target = tripBudgetTarget(meta.toJSON())
        return {
          reply: target
            ? `Trip budget target is ${amountText(target)} for the group.`
            : `No trip budget target yet. Try ${targetExample}`,
          changed: false,
        }
      }
      if (parsed.action === 'expense') {
        const fail = (message) => ({ reply: `${message} Try ${expenseExample}`, changed: false })
        const money = tripMoney(doc, parsed)
        if (money.error === 'currency') return fail('Include the currency code for this expense.')
        if (money.error || money.minor === 0) return fail('Enter a positive amount in a supported currency.')
        if (parsed.split !== undefined && !parsed.splitAmong?.length)
          return { reply: 'Who should share this expense? Use their trip display names.', changed: false }
        const roster = doc.getMap('pilotRoster')
        if (!roster.has(context.senderId)) return fail('Your trip membership could not be verified.')
        const expenseId = saveExpense(doc, {
          ...money,
          title: parsed.label,
          paidBy: context.senderId,
          splitAmong: parsed.splitAmong,
        })
        const widgetId = summaryCard(doc)
        const formatted = amountText(money)
        const count = parsed.splitAmong?.length ?? roster.size
        const split = parsed.conversational
          ? parsed.splitAmong
            ? `, split evenly among ${count} selected ${count === 1 ? 'member' : 'members'}`
            : `, split evenly among ${parsed.model ? 'all ' : ''}${count} trip ${count === 1 ? 'member' : 'members'}`
          : ''
        return {
          reply: `Logged ${money.currency === 'USD' ? '$' + formatted.slice(4) : formatted} for ${parsed.label}${split}.`,
          changed: true,
          expenseId,
          widgetId,
        }
      }
      if (parsed.action === 'group-summary') {
        const rows = budgetRows(doc.getMap('pilotRoster').toJSON(), doc.getMap('budgetPreferences').toJSON())
        const count = rows.filter((row) => row.preference).length
        return {
          reply: [
            `Personal budgets: ${count} of ${rows.length} responded.`,
            ...budgetRanges(rows, true),
          ].join('\n'),
          changed: false,
        }
      }
      if (parsed.action === 'set' && parsed.conversational) {
        const value = tripMoney(doc, parsed)
        if (value.error)
          return { reply: `Use a valid amount with a currency. Try ${example}.`, changed: false }
        parsed = { ...parsed, ...value }
      }
      const preferences = doc.getMap('budgetPreferences')
      if (parsed.action === 'summary')
        return {
          reply: budgetSummary(doc.getMap('pilotRoster').toJSON(), preferences.toJSON(), context.senderId),
          changed: false,
        }
      const widgetId = summaryCard(doc)
      const previous = preferences.get(context.senderId)
      if (parsed.action === 'clear') {
        preferences.delete(context.senderId)
        return {
          reply: previous ? 'Your budget preference is cleared.' : 'Your budget is already unknown.',
          changed: !!previous,
          widgetId,
        }
      }
      const changed =
        !validBudget(previous) || previous.currency !== parsed.currency || previous.minor !== parsed.minor
      if (changed)
        preferences.set(context.senderId, {
          currency: parsed.currency,
          minor: parsed.minor,
          updatedAt: Date.now(),
        })
      return {
        reply: budgetSummary(doc.getMap('pilotRoster').toJSON(), preferences.toJSON(), context.senderId),
        changed,
        widgetId,
        budgetAction: 'set',
      }
    },
  })
}

// Only the original, unresized pilot defaults are compacted. Never move a card or infer preferences from expenses.
export function migratePlanningCards(doc) {
  const widgets = doc.getMap('widgets')
  const proven = new Map(
    [...doc.getMap('pilotMessageReceipts').values()]
      .filter((r) => ['wanda-budget', 'wanda-places'].includes(r.command) && r.outcome?.widgetId)
      .map((r) => [r.outcome.widgetId, r.command === 'wanda-budget' ? 'preferences' : 'saved-places']),
  )
  for (const [id, stored] of widgets) {
    const purpose = proven.get(id)
    const w =
      !stored.purpose &&
      ((purpose === 'preferences' && stored.type === 'budget') ||
        (purpose === 'saved-places' && stored.type === 'map'))
        ? { ...stored, purpose }
        : stored
    if (w !== stored) widgets.set(id, w)
    const old =
      w.type === 'budget' && w.purpose === 'preferences'
        ? 600
        : w.type === 'map' && w.purpose === 'saved-places'
          ? 620
          : null
    if (old && !w.userResized && w.w === undefined && w.h === old)
      widgets.set(id, { ...w, h: w.type === 'map' ? 456 : 336 })
  }
}
