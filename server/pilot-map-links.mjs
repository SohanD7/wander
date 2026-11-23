// Classify split map commands before ordinary link notes. Durable holding is intentionally bounded.
import { correlateLinks, adjacentSplit, GAP_MS, RETAIN_MS, MAX_FRAGMENTS } from './pilot-link-correlation.mjs'
import { linkMessage } from './link-message.mjs'
import { parseMapLink } from '../src/collab/pilot-places.mjs'
export function createMapLinkBridge({ room, persistNow, chatId, allowedSenders, authorizedSenderId }) {
  let timer, fallback, closed = false
  const active = () => room()?.doc.getMap('pilotMapLinkFragments')
  function resume() {
    clearTimeout(timer)
    if (closed || !fallback) return
    const r = room(); if (!r) return
    const map = active(), now = Date.now()
    for (const [id, fragment] of map) {
      if (fragment.chatId !== chatId || (authorizedSenderId ? !authorizedSenderId(fragment.senderId) : allowedSenders && !allowedSenders.has(fragment.senderId))) { map.delete(id); persistNow(r); continue }
      if (fragment.expiresAt > now) continue
      if (fragment.kind === 'link') {
        const result = fallback({ ...fragment.context, deferredComment: fragment.comment, deferredCommentId: fragment.commentMessageId })
        if (result.status !== 200) continue // retain and retry; normal ingress persistence/replay remains authoritative
      }
      map.delete(id); persistNow(r)
    }
    if (map.size) timer = setTimeout(resume, Math.max(100, Math.min(1000, ...[...map.values()].map((f) => f.expiresAt - Date.now()))))
  }
  function observe(context) {
    const r = room(); if (!r || r.doc.getMap('pilotMessageReceipts').has(context.messageId)) return true
    const sequence = r.doc.getMap('pilotMapLinkSequence'), now = Date.now()
    for (const [id, f] of sequence) if (now - f.arrivedAt > RETAIN_MS) sequence.delete(id)
    if (!sequence.has(context.messageId)) sequence.set(context.messageId, { providerId: context.providerId, senderId: context.senderId, arrivedAt: now })
    while (sequence.size > MAX_FRAGMENTS) sequence.delete(sequence.keys().next().value)
    return persistNow(r)
  }
  function resolve(context, parsed) {
    const r = room(); if (!r) return { parsed }
    const fragments = active(), receipts = r.doc.getMap('pilotMessageReceipts')
    if (receipts.has(context.messageId)) return { parsed }
    const url = parseMapLink(context.text.trim())
    const isLink = !url.error
    if (parsed?.action !== 'await_link' && !isLink) return { parsed }
    const kind = isLink ? 'link' : 'comment'
    const current = { ...context, kind, chatId, arrivedAt: Date.now(), expiresAt: Date.now() + RETAIN_MS }
    const match = [...fragments].find(([, f]) => {
      if (f.kind === kind || Date.now() > f.expiresAt || f.senderId !== context.senderId || f.chatId !== chatId) return false
      const [command, link] = isLink ? [f, current] : [current, f]
      // A direct reply to the original inbound command or its saved missing-link reply is unambiguous.
      const reply = link.replyTo, job = r.doc.getMap('pilotPlaceDeliveries').get(command.messageId)
      const direct = reply && ((reply.id != null && [command.providerId, job?.providerMessageId].some((id) => id != null && String(id) === String(reply.id))) || (reply.guid && job?.providerGuid === reply.guid))
      const bounded = Number.isSafeInteger(command.timestamp) && Number.isSafeInteger(link.timestamp) && link.timestamp >= command.timestamp && link.timestamp - command.timestamp <= GAP_MS && BigInt(link.providerId) > BigInt(command.providerId)
      // Provider history showed our outbound usage reply between command and URL (IDs differ by 3).
      // For explicit map commands only, require adjacent observed inbound records from this sender.
      const interrupted = [...r.doc.getMap('pilotMapLinkSequence').values()].some((f) => f.senderId === context.senderId && BigInt(f.providerId) > BigInt(command.providerId) && BigInt(f.providerId) < BigInt(link.providerId))
      return direct || adjacentSplit(command, link) || (bounded && !interrupted && r.doc.getMap('pilotMapLinkSequence').has(command.messageId) && r.doc.getMap('pilotMapLinkSequence').has(link.messageId))
    })
    if (match) {
      const [otherId, other] = match, link = isLink ? current : other
      return { parsed: { action: 'url', ...parseMapLink(link.text.trim()), pairedFragment: otherId, pairedContext: other } }
    }
    if (!isLink) return { parsed: { ...parsed, fragment: current } }
    // Ordinary map-only shares wait up to one minute; classification and timer survive restart.
    const old = fragments.get(context.messageId)
    if (old && (old.text !== context.text || old.senderId !== context.senderId)) return { response: { status: 409, body: { error: 'messageId already used with different content' } } }
    if (!old) {
      if (fragments.size >= MAX_FRAGMENTS) return { response: { status: 503, body: { error: 'split-message buffer full; retry' } } }
      const receipt = {}
      const comment = correlateLinks({ doc: r.doc, messageId: context.messageId, senderId: context.senderId, text: context.text, links: linkMessage(context.text), context, receipt })
      fragments.set(context.messageId, { ...current, context, comment, commentMessageId: receipt.commentMessageId })
    }
    if (!persistNow(r)) return { response: { status: 503, body: { error: 'could not persist; retry' } } }
    resume()
    return { response: { status: 200, body: { ok: true, duplicate: !!old, deferred: 'map link correlation', messageId: context.messageId } } }
  }
  return { observe, resolve, resume, setFallback(fn) { fallback = fn; resume() }, close() { closed = true; clearTimeout(timer) } }
}
