import { wandaCommandText } from './wanda-command.mjs'
import { createCommandFeature } from './pilot-command-feature.mjs'
import { parseBudgetAmount, validBudget, budgetSummary } from '../src/collab/pilot-budget.mjs'
import { placementWidgets } from '../src/collab/checklists.mjs'
import { placeWidget } from '../src/collab/placement.mjs'
const example = '@Wanda budget USD 600 per person'
export function parseWandaBudget(text) {
  const command = wandaCommandText(text)
  if (!command || !/^budget\b/i.test(command)) return null
  const rest = command.replace(/^budget\b/i, '').trim()
  if (/^(summary|clear)$/i.test(rest)) return { action: rest.toLowerCase() }
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
  const card = { id: selected, type, purpose, h: type === 'map' ? 456 : 336, ...(type === 'map' ? { place: '' } : {}), ...placeWidget(placementWidgets(doc, widgets.values()), { type, h: type === 'map' ? 456 : 336 }), z: Math.max(0, ...[...widgets.values()].map((w) => w.z)) + 1 }
  widgets.set(selected, card)
  return selected
}
export function createPilotBudgets(options) {
  const { config } = options
  return createCommandFeature({ ...options, enabled: config?.budgets, mapName: 'pilotBudgetDeliveries', commandName: 'wanda-budget', apply: (doc, context, parsed) => {
    if (parsed.error) return { reply: parsed.error, changed: false }
    const widgetId = ensureSummaryCard(doc, 'budget', 'preferences', 'w_budget_preferences'), preferences = doc.getMap('budgetPreferences')
    if (parsed.action === 'summary') return { reply: budgetSummary(doc.getMap('pilotRoster').toJSON(), preferences.toJSON(), context.senderId), changed: false, widgetId }
    const previous = preferences.get(context.senderId)
    if (parsed.action === 'clear') {
      preferences.delete(context.senderId)
      return { reply: previous ? 'Your budget preference is cleared.' : 'Your budget is already unknown.', changed: !!previous, widgetId }
    }
    const changed = !validBudget(previous) || previous.currency !== parsed.currency || previous.minor !== parsed.minor
    if (changed) preferences.set(context.senderId, { currency: parsed.currency, minor: parsed.minor, updatedAt: Date.now() })
    return { reply: budgetSummary(doc.getMap('pilotRoster').toJSON(), preferences.toJSON(), context.senderId), changed, widgetId }
  } })
}

// Only the original, unresized pilot defaults are compacted. Never move a card or infer preferences from expenses.
export function migratePlanningCards(doc) {
  const widgets = doc.getMap('widgets')
  const proven = new Map([...doc.getMap('pilotMessageReceipts').values()].filter((r) => ['wanda-budget', 'wanda-places'].includes(r.command) && r.outcome?.widgetId).map((r) => [r.outcome.widgetId, r.command === 'wanda-budget' ? 'preferences' : 'saved-places']))
  for (const [id, stored] of widgets) {
    const purpose = proven.get(id)
    const w = !stored.purpose && ((purpose === 'preferences' && stored.type === 'budget') || (purpose === 'saved-places' && stored.type === 'map')) ? { ...stored, purpose } : stored
    if (w !== stored) widgets.set(id, w)
    const old = w.type === 'budget' && w.purpose === 'preferences' ? 600 : w.type === 'map' && w.purpose === 'saved-places' ? 620 : null
    if (old && !w.userResized && w.w === undefined && w.h === old) widgets.set(id, { ...w, h: w.type === 'map' ? 456 : 336 })
  }
}
