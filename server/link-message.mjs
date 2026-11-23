import { LinkifyIt } from 'linkify-it'
import { destinationVote } from './vote-command.mjs'

// Server-only recognition; never resolve a domain or fetch a linked page.
const parser = new LinkifyIt({ fuzzyLink: true, fuzzyEmail: false, fuzzyIP: false })
parser.add('ftp:', null).add('mailto:', null).add('//', null)
export function linkMessage(text) {
  const urls = []
  if (typeof text !== 'string') return { urls, comment: '', voteText: null }
  let withoutLinks = '', offset = 0
  for (const match of parser.match(text) ?? []) {
    // Don't recognize the domain portion of an email or another URI scheme.
    if (/[@\w]/u.test(text[match.index - 1] ?? '') || /(?:[a-z][a-z0-9+.-]*:\/\/|mailto:)$/i.test(text.slice(0, match.index))) continue
    const raw = match.raw
    const url = match.schema ? raw : `https://${raw}`
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) continue
      if (!urls.includes(url)) urls.push(url)
      let start = match.index, end = match.lastIndex
      const pairs = { '(': ')', '[': ']', '{': '}' }
      while (start > offset && pairs[text[start - 1]] === text[end] && text[end] !== undefined) { start--; end++ }
      while (end < text.length && /[.,!?:;]/.test(text[end])) end++
      withoutLinks += text.slice(offset, start)
      offset = end
    } catch { /* leave unrecognized text in the comment */ }
  }
  const comment = (withoutLinks + text.slice(offset)).trim()
  const votes = comment.split(/\r?\n/).map((line) => line.trim()).filter((line) => destinationVote(line))
  return { urls, comment, voteText: votes.length === 1 ? votes[0] : null }
}
