// Provider history showed consecutive comment/link records 5.1–5.4s apart, with no shared GUID.
// This intentionally narrow heuristic is bounded, durable, and never consumes a comment twice.
export const GAP_MS = 6000
export const RETAIN_MS = 60000
export const MAX_FRAGMENTS = 128
export function correlateLinks({ doc, messageId, senderId, text, links, context, receipt, now = Date.now() }) {
  if (!context || !Number.isSafeInteger(context.timestamp) || context.timestamp <= 0) return links.comment
  const fragments = doc.getMap('pilotLinkFragments')
  for (const [key, f] of fragments) if (now - f.arrivedAt > RETAIN_MS) fragments.delete(key)
  const isLink = links.urls.length > 0
  // Own comments always win. Pure votes/control/short chatter are never comment candidates.
  const prose = links.comment.split(/\r?\n/).filter((line) => !/^\s*i vote for .+$/i.test(line)).join('\n').trim()
  if ((isLink && links.comment) || (!isLink && (prose.length < 10 || !/\s/.test(prose) || /^(board|https?:)/i.test(prose)))) return links.comment
  const fragment = { providerId: context.providerId, chatId: context.chatId, timestamp: context.timestamp, senderId,
    arrivedAt: now, text, cardIds: receipt.cardIds ?? [], kind: isLink ? 'link' : 'comment' }
  const match = [...fragments.entries()].find(([, f]) => {
    if (f.kind === fragment.kind || f.senderId !== senderId || f.chatId !== fragment.chatId) return false
    const [comment, link] = isLink ? [f, fragment] : [fragment, f]
    return adjacentSplit(comment, link)
  })
  if (!match) {
    fragments.set(messageId, fragment)
    while (fragments.size > MAX_FRAGMENTS) fragments.delete(fragments.keys().next().value)
    return links.comment
  }
  const [otherId, other] = match
  fragments.delete(otherId)
  const commentId = isLink ? otherId : messageId
  const linkId = isLink ? messageId : otherId
  const comment = isLink ? other.text : text
  receipt.correlatedMessageId = otherId
  const receipts = doc.getMap('pilotMessageReceipts')
  const old = receipts.get(otherId)
  if (old) receipts.set(otherId, { ...old, correlatedMessageId: messageId })
  if (isLink) { receipt.commentMessageId = commentId; return comment }
  const held = doc.getMap('pilotMapLinkFragments').get(linkId)
  if (held?.kind === 'link') doc.getMap('pilotMapLinkFragments').set(linkId, { ...held, comment, commentMessageId: commentId })
  // Late comment: update only untouched cards; preserve edits, deletion, placement and acknowledgment state.
  const widgets = doc.getMap('widgets')
  for (const id of other.cardIds) {
    const w = widgets.get(id)
    if (w?.source?.messageId === linkId && w.text === w.source.url) widgets.set(id, {
      ...w, text: w.source.url + '\n\n' + comment, source: { ...w.source, commentMessageId: commentId, commentText: comment },
    })
  }
  return links.comment
}

export function adjacentSplit(comment, link) {
  return comment.senderId === link.senderId && comment.chatId === link.chatId && comment.providerId && link.providerId && Number.isSafeInteger(comment.timestamp) && Number.isSafeInteger(link.timestamp) && BigInt(link.providerId) === BigInt(comment.providerId) + 1n && link.timestamp >= comment.timestamp && link.timestamp - comment.timestamp <= GAP_MS
}
