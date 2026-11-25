import { checklistItems } from '../../src/collab/checklists.mjs'
import { budgetRows, expenseParticipants, tripFinances } from '../../src/collab/pilot-budget.mjs'
import { savedPlaceRows, validLocation, parseMapLink } from '../../src/collab/pilot-places.mjs'
import { pollWaiting } from '../../src/collab/poll-deadline.mjs'
export function boardView(doc, identity) {
  const map = (key) => doc.getMap(key)
  const member = (id, fallback) => {
    const name = map('members').get(id)?.name ?? fallback
    return !name ? 'Trip member' : /^\+\d+$/.test(name) ? 'Member ' + name.slice(-4) : name
  }
  const cards = [...map('widgets').values()].map((w) => {
    const base = { id: w.id, type: w.type, z: w.z ?? 1, x: w.x, y: w.y, w: w.w, h: w.h }
    if (w.type === 'vote')
      return {
        ...base,
        title: w.question,
        voteSummary: (() => {
          const count = new Set(
            [...map('votes').keys()].filter((k) => k.startsWith(w.id + '|')).map((k) => k.split('|')[2]),
          ).size
          return count + ' of ' + Math.max(count, w.eligible || 0) + ' voted · ' + (w.closes || 'no deadline')
        })(),
        due: w.due,
        // Trip members who haven't voted yet, by display name (the canvas lists them and builds a reminder).
        // The active iMessage roster when there is one, so people who left the group aren't listed.
        waiting: pollWaiting(
          w.id,
          map('pilotRoster').size ? map('pilotRoster').keys() : map('members').keys(),
          map('members').keys(),
          map('votes').keys(),
        )?.map((id) => (id === identity ? 'you' : member(id))),
        nativePoll: w.nativePoll && {
          state: w.nativePoll.state,
          unsupported: w.nativePoll.reason === 'poll_unsupported',
        },
        options: w.options.map((o) => {
          const key = w.id + '|' + o.id + '|'
          const voters = [...map('votes').keys()]
            .filter((k) => k.startsWith(key))
            .map((k) => k.slice(key.length))
          return {
            id: o.id,
            text: o.text,
            voters: voters.map((id) => member(id)),
            mine: voters.includes(identity),
          }
        }),
      }
    if (w.type === 'checklist')
      return {
        ...base,
        title: w.title,
        by: w.source?.senderId ? member(w.source.senderId) : undefined,
        items: checklistItems(doc, w).map((i) => ({
          id: i.id,
          text: i.text,
          done: !!map('checks').get(w.id + '|' + i.id),
        })),
      }
    if (w.type === 'budget') return { ...base, title: 'Trip budget' }
    if (w.type === 'map' && w.purpose === 'saved-places') {
      const pending = [...map('pendingPlaces').values()].filter((p) => p.expiresAt > Date.now())
      const waiting = pending.some((p) => p.status === 'awaiting_confirmation')
      const searching = pending.some((p) => p.status === 'lookup_pending')
      return {
        ...base,
        title: 'Saved places',
        usesPhoton:
          [...map('placeLocations').values()].some((p) => p.provider === 'photon') ||
          [...map('savedPlaces').values()].some((p) => p.location?.provider === 'photon'),
        status: searching
          ? 'Looking up a place…'
          : waiting
            ? 'Waiting for a place selection in iMessage.'
            : undefined,
        places: savedPlaceRows(
          map('savedPlaces').toJSON(),
          map('savedPlaceLabels').toJSON(),
          map('placeLocations').toJSON(),
        ).map((p) => ({
          id: p.id,
          by: member(p.source?.senderId),
          label: p.label,
          url: p.url && !parseMapLink(p.url).error ? p.url : null,
          point: validLocation(p.location) ? [p.location.lat, p.location.lon] : null,
        })),
      }
    }
    return {
      ...base,
      title: w.type === 'note' ? member(w.source?.senderId, w.author) : w.type,
      text: w.text ?? w.place ?? '',
      url: w.source?.url && /^https?:\/\//i.test(w.source.url) ? w.source.url : undefined,
    }
  })
  const members = Object.fromEntries(
    [...map('members').keys()]
      .filter((id) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id))
      .map((id) => [id, { id, name: member(id), tone: 'sea', status: 'joined' }]),
  )
  const days = [...map('days').values()]
    .map(({ id, n, title, date }) => ({ id, n, title, date }))
    .sort((a, b) => a.n - b.n)
  const stops = [...map('stops').values()].map(({ id, dayId, order, title, sub, time, icon }) => ({
    id,
    dayId,
    order,
    title,
    sub,
    time,
    icon,
  }))
  const activeIds = [...map('pilotRoster').keys()]
  const expenses = [...map('expenses').values()]
    .map(({ id, title, amount, currency, minor, paidBy, category, splitAmong, date, createdAt }) => ({
      id,
      title,
      amount,
      currency,
      minor,
      paidBy: Object.hasOwn(members, paidBy) ? paidBy : 'unknown',
      category,
      splitAmong: expenseParticipants({ splitAmong }, activeIds).filter((k) => Object.hasOwn(members, k)),
      date,
      createdAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
  const paid = Object.fromEntries(
    [...map('paid')].filter(([key]) =>
      (key.split(':').at(-1) ?? '').split('>').every((id) => Object.hasOwn(members, id)),
    ),
  )
  const activity = doc
    .getArray('workspaceActivity')
    .toArray()
    .slice(-20)
    .map(({ id, byId, ts, text }) => ({ id, byId, ts, text, by: member(byId) }))
  return {
    title: map('meta').get('name'),
    cards,
    days,
    stops,
    expenses,
    budget: {
      ...tripFinances(map('meta').toJSON(), expenses),
      rows: budgetRows(map('pilotRoster').toJSON(), map('budgetPreferences').toJSON()).map(
        ({ id, preference }) => ({ id, name: member(id), preference }),
      ),
    },
    members,
    paid,
    activity,
    viewerId: identity,
  }
}
