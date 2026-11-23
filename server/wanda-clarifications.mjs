import { createCommandFeature } from './pilot-command-feature.mjs'
import { clarificationQuestion, interpretAnswer, interpretWanda, listMatches } from './wanda-language.mjs'
import { listKey } from './zerosettle-lists.mjs'
import { checklistItems } from '../src/collab/checklists.mjs'

const TTL = 15 * 60 * 1000
const MAX_PENDING = 50
const deliveryMap = 'pilotWandaClarificationDeliveries'
const promptMap = 'pilotWandaClarifications'
const receiptName = 'wanda-clarification'
const clip = (text) => [...text].slice(0, 60).join('')

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

export function createWandaClarifications(options) {
  const { config } = options
  if (!config?.naturalLanguage) return null
  const feature = createCommandFeature({
    ...options,
    enabled: true,
    mapName: deliveryMap,
    commandName: receiptName,
    apply(doc, context, { prompt, reply }) {
      const pending = doc.getMap(promptMap),
        now = Date.now()
      for (const [id, entry] of pending) if (entry.expiresAt <= now) pending.delete(id)
      if (prompt) {
        if (pending.size >= MAX_PENDING)
          return { changed: false, reply: 'There are too many open questions. Try again in a few minutes.' }
        pending.set(context.messageId, { prompt, senderId: context.senderId, expiresAt: now + TTL })
      }
      return { changed: false, reply: reply ?? clarificationQuestion(prompt) }
    },
  })

  function resolve(doc, intent) {
    if (intent.kind === 'ask') return { feature: 'clarify', parsed: { prompt: intent.prompt }, needs: 'poll' }
    if (intent.kind === 'poll') return { feature: 'poll', parsed: { ...intent, valid: true } }
    if (intent.kind === 'cancel')
      return { feature: 'clarify', parsed: { reply: 'Okay, left the board as it is.' } }
    if (intent.kind !== 'list') return null
    const { action, title, items, listId, itemId } = intent
    if (action === 'list') return { feature: 'list', parsed: { action, title, items, valid: true } }
    const lists = [...doc.getMap('widgets').values()].filter((w) => w.type === 'checklist')
    const matches = listMatches(lists, title)
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
    if (action === 'done') {
      const matches = checklistItems(doc, widget)
        .map((item, index) => ({ ...item, index }))
        .filter((item) => listKey(item.text) === listKey(items[0]))
      if (itemId && !matches.some((item) => item.id === itemId))
        return ask(null, 'That item changed. Please send the request again with its current name.')
      if (!itemId && matches.length > 1) {
        if (matches.length > 5)
          return ask(null, 'Several items match. Can you give them distinct names on the board?')
        return ask({
          type: 'choose-item',
          intent: { ...intent, listId: widget.id },
          choices: matches.map((item) => ({
            id: item.id,
            label: `${clip(item.text)} · item ${item.index + 1}`,
          })),
        })
      }
    }
    return {
      feature: 'list',
      parsed: { action, title: widget.title, items, valid: true, listId: widget.id, itemId },
    }
  }

  function route(context, { allowFresh = true, allowAnswer = true } = {}) {
    const room = feature.room()
    if (!feature.usable(room)) return null
    const { doc } = room,
      receipts = doc.getMap('pilotMessageReceipts')
    const previous = receipts.get(context.messageId)
    if (previous?.interpreted || previous?.command === receiptName) {
      return {
        feature:
          previous.command === 'wanda-poll' ? 'poll' : previous.command === 'wanda-list' ? 'list' : 'clarify',
      }
    }
    if (previous || !allowAnswer) return null
    const pending = doc.getMap(promptMap),
      jobs = doc.getMap(deliveryMap)
    const now = Date.now()
    const explicit = /^\s*@wanda\s+answer\b/i.test(context.text)
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
    }

    if (selected) {
      const [id, entry] = selected
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
      return { ...resolve(doc, intent), consumed: id }
    }
    const intent = allowFresh && interpretWanda(context.text)
    return intent ? resolve(doc, intent) : null
  }

  function record(doc, context, route) {
    if (route.consumed) doc.getMap(promptMap).delete(route.consumed)
    const receipts = doc.getMap('pilotMessageReceipts'),
      receipt = receipts.get(context.messageId)
    receipts.set(context.messageId, { ...receipt, interpreted: true })
  }

  return { ...feature, route, record }
}
