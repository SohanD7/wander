import crypto from 'node:crypto'
import { wandaCommandText } from './wanda-command.mjs'
import { createDeliveryQueue } from './zerosettle-delivery.mjs'
import { sendZeroSettleText } from './zerosettle-ack.mjs'
import { placeWidget } from '../src/collab/placement.mjs'
import { checklistItems, ensureChecklist, appendChecklistItems, placementWidgets } from '../src/collab/checklists.mjs'

export const listKey = (value) => value.trim().replace(/\s+/gu, ' ').toLowerCase()
const chars = (value) => [...value].length
export function parseWandaList(text) {
  const command = wandaCommandText(text), match = command && /^(list|add|done|undo)\b/i.exec(command)
  if (!match) return null
  const action = match[1].toLowerCase()
  const error = (message) => ({ action, valid: false, reply: message })
  if (chars(text.trim()) > 4000) return error('That command is too long. Please keep it to 4,000 characters or fewer.')
  let rest = command.slice(match[0].length).trim()
  if (action === 'add') {
    if (!/^to(?:\s|$)/i.test(rest)) return error('Please put ‘to’ after ‘add’, then the list name.')
    rest = rest.replace(/^to(?:\s|$)/i, '').trim()
  }
  const [title, ...items] = rest.split('|').map((value) => value.trim())
  if (!title) return error('Please include the list name before ‘|’.')
  if (chars(title) > 80) return error('That list name is too long. Please shorten it to 80 characters or fewer.')
  if (!items.length || items.some((value) => !value)) return error('Please include an item after each ‘|’.')
  if ((action === 'done' || action === 'undo') && items.length !== 1) return error('Please name exactly one item to mark.')
  if (items.length > 20) return error('That’s too many items for one message. Please send 20 at a time.')
  if (items.some((value) => chars(value) > 200)) return error('That item is too long. Please shorten it to 200 characters or fewer.')
  if ([title, ...items].some((value) => [...value].some((c) => c.charCodeAt(0) < 32))) return error('Please use single-line names and items, separated by ‘|’.')
  if (new Set(items.map(listKey)).size !== items.length) return error('An item appears more than once. Please include each item once.')
  return { action, valid: true, title, items }
}
export function recoverListDeliveries(doc) {
  for (const [id, job] of doc.getMap('pilotListDeliveries')) if (job.state === 'sending') {
    doc.getMap('pilotListDeliveries').set(id, { ...job, state: 'uncertain', reason: 'relay_restarted' })
  }
}
export function createPilotLists({ config, roomForTrip, persistNow, fetchImpl }) {
  if (!config?.lists) return null
  if (!config.apiKey) throw new Error('ZeroSettle checklist commands require a server API key')
  const room = () => roomForTrip(config.tripId)
  const usable = (r) => r && r.doc.getMap('meta').get('seeded') && !r.doc.getMap('meta').get('deleted')
  const queue = createDeliveryQueue({
    enabled: true,
    pending: () => { const r = room(); return usable(r) ? [...r.doc.getMap('pilotListDeliveries')].filter(([, job]) => job.state === 'pending' && job.chatId === config.chatId).map(([id]) => id) : [] },
    claim: (id) => {
      const r = room(); if (!usable(r)) return null
      const jobs = r.doc.getMap('pilotListDeliveries'), previous = jobs.get(id)
      if (previous?.state !== 'pending' || previous.chatId !== config.chatId) return null
      jobs.set(id, { ...previous, state: 'sending', attemptedAt: Date.now() })
      if (!persistNow(r)) { jobs.set(id, previous); return null }
      return previous
    },
    deliver: (job, signal) => sendZeroSettleText({ config, chatId: job.chatId, text: job.reply, signal, fetchImpl }),
    finish: (id, outcome) => {
      const r = room(); if (!usable(r)) return
      const jobs = r.doc.getMap('pilotListDeliveries'), previous = jobs.get(id)
      if (!previous || !['sending', 'uncertain'].includes(previous.state)) return
      jobs.set(id, { ...previous, ...outcome, finishedAt: Date.now() }); persistNow(r)
    },
  })
  function apply(doc, command, messageId, senderId, name) {
    if (!command.valid) return { reply: command.reply, changed: false }
    const { action, title, items, listId, itemId } = command
    const fail = (message) => ({ changed: false, reply: message })
    const widgets = doc.getMap('widgets'), matches = [...widgets.values()].filter((w) => w.type === 'checklist' && (!listId || w.id === listId) && listKey(w.title) === listKey(title))
    if (matches.length > 1) return fail(`I found more than one list called ${title}. Give them distinct names on the canvas.`)
    if (action === 'list') {
      if (matches.length) return fail(`${title} already exists. Choose a different list name.`)
      const hash = crypto.createHash('sha256').update(messageId).digest('hex').slice(0, 24), id = 'w_list_' + hash
      const entries = items.map((text, index) => ({ id: `c_${hash}_${index}`, text }))
      const w = { id, type: 'checklist', title, items: entries, ...placeWidget(placementWidgets(doc, widgets.values()), { type: 'checklist', items: entries, source: { provider: 'zerosettle' } }),
        z: Math.max(0, ...[...widgets.values()].map((w) => w.z)) + 1,
        source: { provider: 'zerosettle', messageId, senderId, author: name },
      }
      widgets.set(id, w); ensureChecklist(doc, w)
      return { changed: true, widgetId: id, itemIds: entries.map((i) => i.id), reply: `Created ${title} with ${items.length} item${items.length === 1 ? '' : 's'}.` }
    }
    if (!matches.length) return fail(`I couldn’t find a list called ${title}. Check the list name.`)
    const w = matches[0]
    ensureChecklist(doc, w)
    const existing = checklistItems(doc, w)
    const itemMatches = items.map((text) => existing.filter((item) => (!itemId || item.id === itemId) && listKey(item.text) === listKey(text)))
    const ambiguous = itemMatches.findIndex((m) => m.length > 1)
    if (ambiguous >= 0) return fail(`I found more than one ‘${items[ambiguous]}’ in ${w.title}. Give them distinct names on the canvas.`)
    if (action === 'add') {
      const additions = items.filter((_, i) => !itemMatches[i].length), duplicates = items.filter((_, i) => itemMatches[i].length)
      if (existing.length + additions.length > 100) return fail(`${w.title} would exceed 100 items. Remove some items before adding more.`)
      const hash = crypto.createHash('sha256').update(messageId).digest('hex').slice(0, 24)
      const entries = additions.map((text, i) => ({ id: `c_${hash}_${i}`, text }))
      appendChecklistItems(doc, w, entries)
      const summary = entries.length ? `Added ${entries.length} item${entries.length === 1 ? '' : 's'} to ${w.title}.` : ''
      const repeated = duplicates.length ? `${entries.length ? ' Already present:' : `Already in ${w.title}:`} ${duplicates.slice(0, 3).map((text) => chars(text) > 60 ? [...text].slice(0, 57).join('') + '…' : text).join(', ')}${duplicates.length > 3 ? ` (+${duplicates.length - 3} more)` : ''}.` : ''
      return { changed: entries.length > 0, widgetId: w.id, itemIds: entries.map((i) => i.id), reply: summary + repeated + (!entries.length ? ` Add ${duplicates.length === 1 ? 'a different item' : 'different items'}.` : '') }
    }
    if (!itemMatches[0].length) return fail(`I couldn’t find ‘${items[0]}’ in ${w.title}. To add it:\n@Wanda add to ${w.title} | ${items[0]}`)
    const item = itemMatches[0][0], checks = doc.getMap('checks'), key = `${w.id}|${item.id}`, complete = action === 'done', was = !!checks.get(key)
    if (was !== complete) checks.set(key, complete)
    return { changed: was !== complete, widgetId: w.id, itemIds: [item.id], reply: was === complete ? `${item.text} is already ${complete ? 'complete' : 'incomplete'} in ${w.title}.` : `${complete ? 'Completed' : 'Reopened'} ${item.text} in ${w.title}.` }
  }
  function command({ messageId, senderId, senderHandle, text }, parsed, onApplied) {
    const r = room(); if (!usable(r)) return { status: 404, body: { error: 'trip not found' } }
    const doc = r.doc, receipts = doc.getMap('pilotMessageReceipts'), previous = receipts.get(messageId)
    if (previous && (previous.senderId !== senderId || previous.text !== text)) return { status: 409, body: { error: 'messageId already used with different content' } }
    if (!previous) doc.transact(() => {
      const name = doc.getMap('members').get(senderId)?.name ?? config.testerNames?.[senderHandle] ?? senderHandle ?? 'Trip tester'
      const outcome = apply(doc, parsed, messageId, senderId, name)
      receipts.set(messageId, { senderId, text, command: 'wanda-list', outcome, by: name })
      doc.getMap('pilotListDeliveries').set(messageId, { state: 'pending', chatId: config.chatId, reply: outcome.reply, createdAt: Date.now() })
      if (outcome.changed) doc.getArray('feed').push([{ id: 'f_' + messageId, by: name, byId: senderId, text: outcome.reply, ts: Date.now() }])
      onApplied?.(doc)
    }, 'wanda-list-command')
    if (!persistNow(r)) return { status: 503, body: { error: 'could not persist; retry the same message' } }
    return { status: 200, body: { ok: true, duplicate: !!previous, messageId, command: 'wanda-list', ...receipts.get(messageId).outcome } }
  }
  return { command, resume: queue.resume, close: queue.close }
}
