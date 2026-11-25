/**
 * Poll reply-by dates and the "who hasn't voted" list, shared by the canvas and the hosted server.
 *
 * A poll's optional `due` is a calendar date (YYYY-MM-DD). Polls without one behave exactly as before:
 * `closes` keeps its existing free text ("no deadline", "closes friday"). Setting a date also rewrites
 * `closes` (e.g. "closes fri, dec 4") so every existing place that shows `closes` stays correct.
 */
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date (rejects 2026-13-45 and Feb 30). */
export function isPollDate(value) {
  if (typeof value !== 'string' || !ISO.test(value)) return false
  const t = Date.parse(value + 'T00:00:00Z')
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value
}

/** A reply-by date someone may set now: a real date from yesterday (time zones) up to two years out. */
export function isSettablePollDate(value, now = Date.now()) {
  if (!isPollDate(value)) return false
  const t = Date.parse(value + 'T00:00:00Z')
  return t >= now - 2 * 864e5 && t <= now + 730 * 864e5
}

const label = (due) =>
  new Date(due + 'T12:00:00Z')
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .toLowerCase()

/** "closes fri, dec 4" for a date, or null when there is none. */
export function closesText(due) {
  return isPollDate(due) ? 'closes ' + label(due) : null
}

/** True once the reply-by date has passed (compared by calendar day, in the viewer's own date). */
export function isPastDue(due, today) {
  return isPollDate(due) && isPollDate(today) && due < today
}

/** Member ids (in member order) who have not voted on this poll yet. */
export function waitingOn(pollId, memberIds, voteKeys) {
  const voted = new Set()
  for (const key of voteKeys) {
    const [widget, , voter] = String(key).split('|')
    if (widget === pollId && voter) voted.add(voter)
  }
  return [...memberIds].filter((id) => !voted.has(id))
}

/**
 * Who still has to vote, or null when that can't be known reliably.
 * `rosterIds` is the active group (people who left are not listed); every vote must come from a known
 * member (`memberIds`), otherwise votes and members don't line up (e.g. demo seed votes) and we show nothing
 * rather than a wrong list.
 */
export function pollWaiting(pollId, rosterIds, memberIds, voteKeys) {
  const members = new Set(memberIds)
  const keys = [...voteKeys]
  for (const key of keys) {
    const [widget, , voter] = String(key).split('|')
    if (widget === pollId && voter && !members.has(voter)) return null
  }
  return waitingOn(pollId, rosterIds, keys)
}

/**
 * A ready-to-paste group chat reminder that names only the people who haven't voted.
 * The organizer sends it themselves, so nothing is texted automatically.
 */
export function reminderText({ question, due, names, link }) {
  const who = names.length ? names.join(', ') + ': ' : ''
  const when = isPollDate(due) ? ' by ' + label(due) : ''
  const q = String(question || '').trim() || 'our trip poll'
  return `${who}quick reminder to vote on "${q}"${when} 🗳️${link ? ' ' + link : ''}`
}
