import { interpretClaude, modelText, requestIdentity } from './wanda-claude.mjs'
import { capabilities, decisionRoute, modelFailure, modelWrites } from './wanda-model-actions.mjs'
import { wandaCommandText } from './wanda-command.mjs'
import { tripFinances } from '../src/collab/pilot-budget.mjs'

const claims = 'pilotWandaModelClaims'

export function modelReplay(doc, context) {
  const accepted = doc?.getMap(claims).get(context.messageId)
  if (!accepted) return null
  return accepted === requestIdentity(context)
    ? { status: 200, body: { ok: true, duplicate: true } }
    : { status: 409, body: { error: 'messageId already used with different content' } }
}

// Valid exact syntax and clearly structured typos bypass inference. A command word by itself
// is not a reason to intercept an ordinary sentence starting with that word.
export function exactWithModel(command, { budget, place, list, poll }) {
  const text = command?.trim() ?? ''
  return {
    budget:
      budget &&
      (!budget.error ||
        /^(?:expense(?:$|.*\||\s+(?:[A-Z]{3}\s+)?\$?\d[\d.,]*(?:\s+(?!for\b|on\b)\S+)?$)|budget(?:$|\s+(?:target\s+[A-Z]{3}\s+\S+$|(?:[A-Z]{3}\s+)?\$?\d[\d.,]*$|.*\bper person$)))/i.test(
          text,
        ))
        ? budget
        : null,
    place:
      place &&
      /^(?:places|place|choose|confirm place|locate place|remove place)(?:\s|$)/i.test(text) &&
      (!/^place\s+/i.test(text) ||
        /^place\s+(?:https?:\/\/|www\.)/i.test(text) ||
        !/[?!]|^place\s+(?:a pin|this|that|it|the pin|on|for)\b/i.test(text)) &&
      (!/^(?:places|choose)\s+/i.test(text) || /^choose\s+\d+$/i.test(text))
        ? place
        : null,
    list: list && (list.valid || (/^(?:list|add|done|undo)\b/i.test(text) && /\|/.test(text))) ? list : null,
    poll: poll && (poll.valid || /^poll$/i.test(text) || text.includes('|')) ? poll : null,
  }
}

export function createWandaModel({ config, language, persistNow, service }) {
  if (!service?.settings.enabled || !language) return null
  const { settings, reserve, fetchImpl, logger } = service
  const stop = new AbortController()

  function accept(context, pending, dispatch) {
    const room = language.room()
    if (!language.usable(room)) return null
    const { doc } = room
    const reference = language.reference(context)
    if (reference?.outcome?.asked && !pending) {
      if (
        !wandaCommandText(context.text) ||
        /^(?:answer\b|[A-Z]{3}[.!]?$|\d+[.!]?$)/i.test(wandaCommandText(context.text).trim())
      )
        return { status: 200, body: { ok: true, ignored: 'closed clarification' } }
    }
    if (!pending && !reference && !wandaCommandText(context.text)?.trim()) return null
    if (doc.getMap('pilotMessageReceipts').has(context.messageId)) return null
    const replay = modelReplay(doc, context)
    if (replay) return replay
    if ((pending?.answer ?? context.text).length > 1800) {
      return dispatch({
        feature: 'clarify',
        parsed: { reply: 'Please send one short trip request at a time.' },
      })
    }
    const map = doc.getMap(claims)
    map.set(context.messageId, requestIdentity(context))
    if (!persistNow(room)) {
      map.delete(context.messageId)
      return { status: 503, body: { error: 'could not persist; retry the same message' } }
    }

    let admitted = false
    try {
      admitted = reserve()
    } catch {
      /* Exact commands remain available when quota storage is unavailable. */
    }
    const input = pending ? { ...context, text: pending.answer } : context
    const meta = {
      capabilities: capabilities(config),
      tripCurrency: tripFinances(doc.getMap('meta').toJSON(), [...doc.getMap('expenses').values()]).preferred,
      ...(reference
        ? {
            replyToWanda:
              reference.senderId === context.senderId && reference.outcome?.expenseId
                ? 'own expense'
                : reference.senderId === context.senderId && reference.outcome?.budgetAction === 'set'
                  ? 'own personal budget'
                  : 'message',
          }
        : {}),
      ...(pending
        ? {
            followUp: {
              original: modelText(pending.prompt.original),
              action: pending.prompt.draft,
              questionType: pending.prompt.reason,
            },
          }
        : {}),
    }

    // The signature, membership, receipt and quota are checked before accepting. A provider
    // response can take longer than its webhook deadline. No transaction remains open here.
    const interpret = admitted
      ? interpretClaude(settings, input, meta, fetchImpl, stop.signal)
      : Promise.resolve({ category: 'daily_cap_or_quota_unavailable', latencyMs: 0 })
    void interpret
      .then(async (result) => {
        if (stop.signal.aborted || !language.usable(room)) return
        if (result.decision && modelWrites(result.decision.kind)) await config.refreshMembership?.()
        if (stop.signal.aborted || !language.usable(room)) return
        if (config.memberAllowed && !config.memberAllowed(context.senderHandle)) return
        if (pending && !language.active(pending.id, context)) return
        const route = result.decision
          ? decisionRoute({ decision: result.decision, context, doc, config, language, pending, reference })
          : modelFailure(context, pending, config)
        // Keep the original clarification open if inference failed or did not understand the answer.
        const applied = dispatch(
          route && pending && result.decision ? { ...route, consumed: pending.id } : route,
        )
        logger({
          outcome: route?.feature ?? 'silent',
          status: applied.status,
          changed: !!applied.body?.changed,
          latency_ms: result.latencyMs,
          category: result.category,
        })
      })
      .catch(() => logger({ outcome: 'silent', category: 'dispatch_error' }))
    return { status: 200, body: { ok: true, accepted: true } }
  }

  return { accept, close: () => stop.abort() }
}
