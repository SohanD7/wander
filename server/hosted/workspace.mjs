import { randomUUID } from 'node:crypto'
import { problem } from './claim.mjs'

function fieldText(value, limit, optional = false) {
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim()))
    throw problem(400, 'Invalid trip field.')
  return value.trim()
}
export function workspaceEdit(doc, edit) {
  const days = doc.getMap('days'),
    stops = doc.getMap('stops'),
    expenses = doc.getMap('expenses'),
    members = doc.getMap('members')
  const addDay = (title = 'new day') => {
    const id = randomUUID(),
      n = 1 + Math.max(0, ...[...days.values()].map((d) => d.n))
    days.set(id, { id, n, title, date: 'day ' + n })
    return id
  }
  const addStop = (dayId, s) => {
    if (
      !days.has(dayId) ||
      !['pin', 'food', 'coffee', 'camera', 'mountain', 'car', 'home', 'ticket'].includes(s.icon)
    )
      throw problem(400, 'Choose a day and stop icon.')
    const id = randomUUID(),
      order = 10 + Math.max(0, ...[...stops.values()].filter((x) => x.dayId === dayId).map((x) => x.order))
    stops.set(id, {
      id,
      dayId,
      order,
      title: fieldText(s.title, 200),
      time: fieldText(s.time, 30, true),
      sub: fieldText(s.sub, 300, true),
      icon: s.icon,
    })
  }
  switch (edit.action) {
    case 'rename-trip':
      doc.getMap('meta').set('name', fieldText(edit.value, 60))
      break
    case 'add-day':
      addDay()
      break
    case 'add-stop':
      addStop(edit.day, edit)
      break
    case 'remove-stop':
      stops.delete(edit.id)
      break
    case 'move-stop': {
      const s = stops.get(edit.id)
      if (!s || !days.has(edit.day) || !Number.isSafeInteger(edit.index) || edit.index < 0)
        throw problem(400, 'Invalid stop move.')
      const list = [...stops.values()]
        .filter((x) => x.dayId === edit.day && x.id !== s.id)
        .sort((a, b) => a.order - b.order)
      const index = Math.min(edit.index, list.length),
        prev = list[index - 1]?.order,
        next = list[index]?.order
      stops.set(s.id, {
        ...s,
        dayId: edit.day,
        order: prev === undefined ? (next ?? 20) - 10 : next === undefined ? prev + 10 : (prev + next) / 2,
      })
      break
    }
    case 'sample-plan': {
      const day = addDay('a day in Athens')
      addStop(day, { title: 'Acropolis walk', time: '9:00a', sub: 'Athens', icon: 'camera' })
      addStop(day, { title: 'Lunch in Plaka', time: '12:00p', sub: 'Athens', icon: 'food' })
      break
    }
    case 'add-expense': {
      if (
        !doc.getMap('pilotRoster').has(edit.paidBy) ||
        !['gas', 'food', 'activities', 'lodging'].includes(edit.category) ||
        !Number.isFinite(edit.amount) ||
        edit.amount < 0.01 ||
        edit.amount > 1e8
      )
        throw problem(400, 'Invalid expense.')
      const id = randomUUID()
      expenses.set(id, {
        id,
        title: fieldText(edit.title, 200),
        amount: Math.round(edit.amount * 100) / 100,
        category: edit.category,
        paidBy: edit.paidBy,
        splitAmong: [...doc.getMap('pilotRoster').keys()],
        date: new Date().toISOString().slice(0, 10),
        createdAt: Date.now(),
      })
      break
    }
    case 'remove-expense':
      expenses.delete(edit.id)
      break
    case 'settle': {
      if (typeof edit.key !== 'string') throw problem(400, 'Unknown transfer.')
      const ids = edit.key.split('>')
      if (ids.length !== 2 || ids.some((id) => !members.has(id)) || typeof edit.selected !== 'boolean')
        throw problem(400, 'Unknown transfer.')
      doc.getMap('paid').set(edit.key, edit.selected)
      break
    }
    default:
      return false
  }
  return true
}
