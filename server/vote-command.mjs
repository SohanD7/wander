// Parse an explicit vote only. The shared handler resolves it against the existing destination poll.
export function destinationVote(text) {
  if (typeof text !== 'string') return null
  const match = /^i\s+vote\s+for\s+([^\r\n]+)$/i.exec(text.trim())
  return match ? normalizeOption(match[1]) : null
}
export const normalizeOption = (text) => text.trim().replace(/\s+/g, ' ').toLowerCase()
