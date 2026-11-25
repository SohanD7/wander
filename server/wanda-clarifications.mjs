import { createCommandFeature } from './pilot-command-feature.mjs'
import {
  clarificationQuestion,
  interpretAnswer,
  interpretWanda,
  listMatches,
  wandaHelpReply,
  wandaHelpIntent,
} from './wanda-language.mjs'
import { hasLiteralWandaAddress, wandaCommandText } from './wanda-command.mjs'
import { linkMessage } from './link-message.mjs'
import { listKey } from './zerosettle-lists.mjs'
import { editCanvas } from './hosted/edits.mjs'
import { checklistItems } from '../src/collab/checklists.mjs'
import { tripMoney } from './zerosettle-budget.mjs'

const TTL = 15 * 60 * 1000
const MAX_PENDING = 50
const deliveryMap = 'pilotWandaClarificationDeliveries'
const promptMap = 'pilotWandaClarifications'
const receiptName = 'wanda-clarification'
const clip = (text) => [...text].slice(0, 60).join('')
const personKey = (name) => name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()

function matchesReply(job, target) {
  if (!target || job?.state !== 'sent') return false
  const id = job.providerMessageId == null ? undefined : String(job.providerMessageId)
  const guid = job.providerGuid
  return (
    !!((target.id && target.id === id) || (target.guid && target.guid === guid)) &&
    (!target.id || !id || target.id === id) &&
    (!target.guid || !guid || target.guid === guid)
  )
}

const replyMaps = [
  deliveryMap,
  'pilotBudgetDeliveries',
  'pilotListDeliveries',
  'pilotPollDeliveries',
  'pilotPlaceDeliveries',
  'pilotAcknowledgments',
  'pilotBoardDeliveries',
]

export function createWandaClarifications(options) {
  const { config } = options
  const clock = options.clock ?? Date.now
  if (!config?.naturalLanguage) return null
  const feature = createCommandFeature({
    ...options,
    enabled: true,
    mapName: deliveryMap,
    commandName: receiptName,
    apply(doc, context, { prompt, reply, rename }) {
      if (rename) {
        editCanvas(doc, context.senderId, context.name, {
          action: 'field',
          card: rename.id,
          value: rename.newTitle,
          previous: rename.previous,
        })
        return { changed: true, widgetId: rename.id, reply }
      }
      if (prompt) {
        const pending = doc.getMap(promptMap),
          now = clock()
        for (const [id, entry] of pending) if (entry.expiresAt <= now) pending.delete(id)
        if (pending.size >= MAX_PENDING)
          return { changed: false, reply: 'There are too many open questions. Try again in a few minutes.' }
        pending.set(context.messageId, { prompt, senderId: context.senderId, expiresAt: now + TTL })
      }
      return {
        changed: false,
        ...(prompt ? { asked: true } : {}),
        reply: reply ?? clarificationQuestion(prompt),
      }
    },
  })

  function clarify(needs, reply, prompt) {
    return { feature: 'clarify', needs, parsed: { prompt, reply } }
  }

  function resolveRename(doc, widgets, intent) {
    const { widgetType, title, newTitle, widgetId } = intent
    const isList = widgetType === 'checklist'
    const featureName = isList ? 'list' : 'poll'
    const getTitle = (widget) => (isList ? widget.title : widget.question)
    const candidates = widgets.filter((widget) => widget.type === widgetType)
    const matches = isList
      ? listMatches(candidates, title)
      : candidates.filter((widget) => listKey(getTitle(widget)) === listKey(title))
    const widget = widgetId ? matches.find((entry) => entry.id === widgetId) : matches[0]
    if (!widget)
      return clarify(
        featureName,
        widgetId
          ? `That ${featureName} changed. Send the request again with its current name.`
          : `I couldn’t find a ${featureName} called “${clip(title)}”. Check its name on the canvas.`,
      )
    if (!widgetId && matches.length > 1) {
      const choices = matches.map((entry) => {
        const description =
          (isList ? 'Checklist' : 'Poll') +
          ' · ' +
          clip(getTitle(entry)) +
          ' · ' +
          clip(
            (isList ? checklistItems(doc, entry) : (entry.options ?? []))
              .slice(0, 2)
              .map((option) => option.text)
              .join(', '),
          )
        return { label: description, intent: { ...intent, widgetId: entry.id } }
      })
      if (
        choices.length > 5 ||
        new Set(choices.map((choice) => listKey(choice.label))).size !== choices.length
      )
        return clarify(featureName, `Several ${featureName}s match. Give them distinct names on the canvas.`)
      return clarify(featureName, undefined, {
        type: 'select-target',
        question: `Which ${featureName} should I rename?`,
        choices,
      })
    }
    const previous = getTitle(widget)
    if (previous === newTitle)
      return clarify(featureName, `That ${featureName} is already called “${newTitle}”.`)
    if (candidates.some((entry) => entry.id !== widget.id && listKey(getTitle(entry)) === listKey(newTitle)))
      return clarify(
        featureName,
        `A ${featureName} called “${newTitle}” already exists. Choose another name.`,
      )
    return {
      feature: 'clarify',
      needs: featureName,
      parsed: {
        rename: { id: widget.id, previous, newTitle },
        reply: `Renamed the ${isList ? 'list' : 'canvas poll'} to “${newTitle}”.`,
      },
    }
  }

  function completion(doc, intent, named) {
    const {
      title,
      items: [text],
      listId,
      itemId,
    } = intent
    const key = listKey(text)
    const scope = listId ? named.filter((widget) => widget.id === listId) : named
    const candidates = scope.flatMap((widget) =>
      checklistItems(doc, widget).map((item, index) => ({ widget, item, index })),
    )
    const exact = candidates.filter(
      ({ item }) => (!itemId || item.id === itemId) && listKey(item.text) === key,
    )
    if (itemId && !exact.length)
      return clarify('list', 'That item changed. Send the request again with its current name.')
    const prefix = exact.length
      ? []
      : candidates.filter(({ item }) => listKey(item.text).startsWith(key + ' '))
    const matches = exact.length ? exact : prefix
    const execute = ({ widget, item }) => ({
      feature: 'list',
      parsed: {
        action: 'done',
        title: widget.title,
        items: [item.text],
        listId: widget.id,
        itemId: item.id,
        valid: true,
      },
    })
    // Exact, unique labels can be checked off directly. Confirm shorter labels and alternate lists.
    if (exact.length === 1 && (!title || listMatches([exact[0].widget], title).length))
      return execute(exact[0])
    if (!matches.length) return null
    if (matches.length > 5)
      return clarify('list', 'Several items match. Include the full item and list names.')
    const choices = matches.map(({ widget, item, index }) => ({
      label: `${clip(item.text)} · ${clip(widget.title || 'Untitled list')} · item ${index + 1}`,
      intent: {
        kind: 'list',
        action: 'done',
        title: widget.title,
        items: [item.text],
        listId: widget.id,
        itemId: item.id,
      },
    }))
    if (new Set(choices.map((choice) => listKey(choice.label))).size !== choices.length)
      return clarify('list', 'I can’t tell those items apart. Give their lists distinct names on the canvas.')
    const first = matches[0]
    return clarify('list', undefined, {
      type: 'select-target',
      choices,
      question:
        matches.length === 1
          ? `Mark “${clip(first.item.text)}” done in ${clip(first.widget.title || 'the untitled list')}?`
          : 'Which item should I check off?',
    })
  }

  function resolveBudget(doc, intent, context) {
    const { parsed } = intent
    const execute = (fields) => ({ feature: 'budget', parsed: fields })
    if (!['expense', 'hypothetical'].includes(parsed.action) || parsed.split === undefined)
      return execute(parsed)
    const money = tripMoney(doc, parsed)
    if (money.error || !money.minor) return execute(parsed)
    if (parsed.split.length > 30)
      return clarify('budget', 'Use up to 30 names for a split, or pick the members in Expenses.')

    const draft = { ...intent, parsed: { ...parsed, split: [...parsed.split], currency: money.currency } }
    const ask = (reply, index, choices) =>
      clarify('budget', reply, { type: 'expense-split', intent: draft, index, choices })
    if (!parsed.split.length)
      return ask('Who should share this expense? Reply with their names as shown on the trip.', null)
    const roster = doc.getMap('pilotRoster')
    const members = [...roster.values()]
    const ids = new Set()
    for (const [index, requested] of parsed.split.entries()) {
      if (typeof requested !== 'string') {
        if (!roster.has(requested.id))
          return ask('That person is no longer on the trip. Who should take their share?', index)
        ids.add(requested.id)
        continue
      }
      const key = personKey(requested)
      if (key === 'me' || key === 'myself') {
        if (!roster.has(context.senderId))
          return execute({ error: 'Your trip membership could not be verified.' })
        draft.parsed.split[index] = { id: context.senderId }
        ids.add(context.senderId)
        continue
      }
      const exact = members.filter(({ name }) => personKey(name) === key)
      if (exact.length === 1) {
        draft.parsed.split[index] = { id: exact[0].id }
        ids.add(exact[0].id)
        continue
      }
      const matches = exact.length
        ? exact
        : members.filter(({ name }) => personKey(name).startsWith(key + ' '))
      const choices = matches.map(({ id, name }) => ({ id, label: clip(name) }))
      if (
        choices.length &&
        choices.length <= 5 &&
        new Set(choices.map(({ label }) => personKey(label))).size === choices.length
      ) {
        const options = choices.map(({ label }, i) => `${i + 1}. ${label}`).join('\n')
        return ask(`Which “${clip(requested)}”? Reply with a number.\n${options}`, index, choices)
      }
      if (matches.length)
        return ask(`Which “${clip(requested)}”? Reply with their full trip display name.`, index)
      return ask(`I couldn’t find “${clip(requested)}”. Who should take that share?`, index)
    }
    return execute({ ...parsed, ...money, splitAmong: [...ids] })
  }

  function resolve(doc, intent, context) {
    if (intent.kind === 'help') return clarify(undefined, wandaHelpReply(intent.topic, config, doc))
    if (intent.kind === 'budget') return resolveBudget(doc, intent, context)
    if (intent.kind === 'ask')
      return clarify(intent.prompt.type === 'poll-choices' ? 'poll' : 'list', undefined, intent.prompt)
    if (intent.kind === 'poll') return { feature: 'poll', parsed: { ...intent, valid: true } }
    if (intent.kind === 'cancel')
      return { feature: 'clarify', parsed: { reply: 'Okay, left the board as it is.' } }
    const widgets = [...doc.getMap('widgets').values()]
    if (intent.kind === 'rename') return resolveRename(doc, widgets, intent)
    if (intent.kind !== 'list') return null
    const { action, title, items, listId, itemId } = intent
    if (action === 'list') return { feature: 'list', parsed: { action, title, items, valid: true } }
    const lists = widgets.filter((w) => w.type === 'checklist')
    const matches = title === undefined ? [] : listMatches(lists, title)
    if (action === 'done') {
      const target = completion(doc, intent, matches.length || listId ? matches : lists)
      if (target) return target
      if (title === undefined)
        return clarify('list', `I couldn’t find “${clip(items[0])}”. Try the item’s full name.`)
    }
    const ask = (prompt, reply) => ({ feature: 'clarify', needs: 'list', parsed: { prompt, reply } })
    if (listId && !matches.some((w) => w.id === listId))
      return ask(null, 'That list changed. Please send the request again with its current name.')
    if (!matches.length) {
      if (items.join(', ').length > 220)
        return ask(null, 'I couldn’t find that list. Send a shorter request to create it.')
      return ask({ type: 'create-list', intent })
    }
    if (!listId && matches.length > 1) {
      if (matches.length > 5)
        return ask(null, 'Several lists match. Can you give the lists distinct names on the board?')
      const choices = matches.map((w) => {
        const items = checklistItems(doc, w)
        const preview = items
          .slice(0, 2)
          .map((item) => item.text)
          .join(', ')
        return {
          id: w.id,
          label: clip(w.title) + (items.length ? ` · ${items.length} items: ${clip(preview)}` : ' · empty'),
        }
      })
      if (new Set(choices.map((choice) => listKey(choice.label))).size !== choices.length) {
        return ask(null, 'I can’t tell those lists apart. Can you give them distinct names on the board?')
      }
      return ask({ type: 'choose-list', intent, choices })
    }
    const widget = matches.find((w) => w.id === listId) ?? matches[0]
    return {
      feature: 'list',
      parsed: { action, title: widget.title, items, valid: true, listId: widget.id, itemId },
    }
  }

  function route(context, { allowFresh = true, allowAnswer = true, modelEnabled = false } = {}) {
    const room = feature.room()
    if (!feature.usable(room)) return null
    const { doc } = room,
      receipts = doc.getMap('pilotMessageReceipts')
    const previous = receipts.get(context.messageId)
    if (previous?.interpreted || previous?.command === receiptName) {
      return {
        feature:
          { 'wanda-poll': 'poll', 'wanda-list': 'list', 'wanda-budget': 'budget', 'wanda-places': 'place' }[
            previous.command
          ] ?? 'clarify',
      }
    }
    if (previous || !allowAnswer) return null
    const request = wandaHelpIntent(context.text) ?? (allowFresh && interpretWanda(context.text))
    // Help is a separate request even when sent in a reply to an active prompt.
    if (request?.kind === 'help') return resolve(doc, request, context)
    const pending = doc.getMap(promptMap),
      jobs = doc.getMap(deliveryMap)
    const now = clock()
    const address = wandaCommandText(context.text)?.trim()
    const explicit = modelEnabled
      ? /^answer\b/i.test(address ?? '')
      : /^\s*@wanda\s+answer\b/i.test(context.text)
    let selected
    if (context.replyTo) {
      selected = [...pending].find(([id]) => matchesReply(jobs.get(id), context.replyTo))
      if (selected && (selected[1].senderId !== context.senderId || selected[1].expiresAt <= now))
        return { ignore: true }
      if (!selected && explicit) return { ignore: true }
    } else if (explicit) {
      const active = [...pending].filter(
        ([, entry]) => entry.senderId === context.senderId && entry.expiresAt > now,
      )
      if (active.length !== 1)
        return {
          feature: 'clarify',
          parsed: {
            reply: active.length
              ? 'Please reply directly to the question you want to answer.'
              : 'I don’t have an open question for you. Send the request again.',
          },
        }
      selected = active[0]
    } else if (modelEnabled && address) {
      const active = [...pending].filter(
        ([, entry]) =>
          entry.senderId === context.senderId &&
          entry.expiresAt > now &&
          shortModelAnswer(entry.prompt, address),
      )
      if (active.length === 1) selected = active[0]
    }

    if (selected) {
      const [id, entry] = selected
      if (entry.prompt.type === 'model') {
        if (!modelEnabled) return { ignore: true }
        const answer = (address ?? context.text).trim().replace(/^answer\s+/i, '')
        if (/^(?:cancel|never mind|stop)[.!]?$/i.test(answer))
          return { ...resolve(doc, { kind: 'cancel' }, context), consumed: id }
        return { pendingModel: { id, prompt: entry.prompt, answer } }
      }
      const intent = interpretAnswer(entry.prompt, context.text)
      if (!intent) return { ignore: true }
      if (entry.prompt.type === 'create-list' && intent.kind === 'list') {
        const lists = [...doc.getMap('widgets').values()].filter((w) => w.type === 'checklist')
        if (listMatches(lists, intent.title).length)
          return {
            feature: 'clarify',
            consumed: id,
            parsed: { reply: `${intent.title} now exists. Send your request again.` },
          }
      }
      // The handler deletes the answered prompt in the same transaction as its receipt and edits.
      return { ...resolve(doc, intent, context), consumed: id }
    }
    if (request) return resolve(doc, request, context)
    if (allowFresh && context.text.length <= 4000 && hasLiteralWandaAddress(context.text)) {
      const { urls, voteText } = linkMessage(context.text)
      if (!urls.length && !voteText)
        return clarify(undefined, 'I didn’t catch that. Try @Wanda help for examples.')
    }
    return null
  }

  function active(id, context) {
    const entry = feature.room()?.doc.getMap(promptMap).get(id)
    return entry?.senderId === context.senderId && entry.expiresAt > clock()
  }

  function reference(context) {
    if (!context.replyTo) return null
    const doc = feature.room()?.doc
    if (!doc) return null
    for (const map of replyMaps) {
      for (const [id, job] of doc.getMap(map)) {
        if (job.chatId !== context.chatId || !matchesReply(job, context.replyTo)) continue
        const receipt = doc.getMap('pilotMessageReceipts').get(id)
        return { ...receipt, trusted: true }
      }
    }
    return null
  }

  function record(doc, context, route) {
    if (route.consumed) doc.getMap(promptMap).delete(route.consumed)
    const receipts = doc.getMap('pilotMessageReceipts'),
      receipt = receipts.get(context.messageId)
    receipts.set(context.messageId, { ...receipt, interpreted: true })
  }

  return { ...feature, route, record, active, reference, resolve }
}

function shortModelAnswer(prompt, text) {
  if (prompt.type !== 'model') return false
  if (/^(?:cancel|never mind|stop)[.!]?$/i.test(text)) return true
  switch (prompt.reason) {
    case 'currency':
      return /^[A-Za-z]{3}[.!]?$/.test(text)
    case 'amount':
      return /^(?:[A-Z]{3}\s+)?[$€£¥]?\s*\d[\d.,]*$/i.test(text)
    case 'kind':
      return /^(?:(?:my|personal|group|trip) budget|(?:group |trip )?target|(?:an )?expense)[.!]?$/i.test(
        text,
      )
    default:
      return false
  }
}
