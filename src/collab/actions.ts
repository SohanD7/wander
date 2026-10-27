import { newId, type Session } from '../lib/session'
import type { TripRoom } from './room'
import type { Day, Expense, Stop, TripSnapshot, Widget, WidgetType } from './types'

/** Canvas snapping grid (matches the dot-grid in Figma). */
export const GRID = 12
export const snap = (n: number) => Math.round(n / GRID) * GRID

const maxZ = (room: TripRoom) => Math.max(0, ...Array.from(room.widgets.values()).map((w) => w.z))

export function pushFeed(room: TripRoom, me: Session, text: string) {
  room.feed.push([{ id: newId('f_'), by: me.name, byId: me.id, text, ts: Date.now() }])
}

/** Replace the whole trip with a snapshot in ONE transaction — every client sees it land at once. */
export function applySnapshot(room: TripRoom, snapshot: TripSnapshot, opts: { keepMembers?: boolean } = {}) {
  room.doc.transact(() => {
    for (const m of [room.widgets, room.days, room.stops, room.expenses, room.votes, room.checks, room.paid]) {
      Array.from(m.keys()).forEach((k) => m.delete(k))
    }
    Object.entries(snapshot.meta).forEach(([k, v]) => room.meta.set(k, v))
    snapshot.widgets.forEach((w) => room.widgets.set(w.id, w))
    snapshot.days.forEach((d) => room.days.set(d.id, d))
    snapshot.stops.forEach((s) => room.stops.set(s.id, s))
    snapshot.expenses.forEach((e) => room.expenses.set(e.id, e))
    for (const [key, voters] of Object.entries(snapshot.votes ?? {})) voters.forEach((v) => room.votes.set(`${key}|${v}`, 0))
    for (const [key, v] of Object.entries(snapshot.checks ?? {})) room.checks.set(key, v)
    void opts
  })
}

const defaults = (type: WidgetType, id: string, x: number, y: number, z: number, me: Session): Widget => {
  const base = { id, x, y, z }
  switch (type) {
    case 'vote':
      return {
        ...base, type, question: 'what should we vote on?', closes: 'no deadline', eligible: 4,
        options: [
          { id: newId('o_'), text: 'option one' },
          { id: newId('o_'), text: 'option two' },
        ],
      }
    case 'budget':
      return { ...base, type }
    case 'note':
      return { ...base, type, text: '', author: me.name }
    case 'checklist':
      return { ...base, type, title: 'checklist', items: [{ id: newId('c_'), text: 'first item' }] }
    case 'map':
      return { ...base, type, place: '', h: 360 }
  }
}

const LABEL: Record<WidgetType, string> = { vote: 'a vote', budget: 'a budget widget', note: 'a note', checklist: 'a checklist', map: 'a map' }

export function makeActions(room: TripRoom, me: Session) {
  return {
    addWidget(type: WidgetType, at?: { x: number; y: number }) {
      const n = room.widgets.size
      const x = snap(at?.x ?? 176 + (n % 3) * 396)
      const y = snap(at?.y ?? 128 + Math.floor(n / 3) * 340)
      const w = defaults(type, newId('w_'), x, y, maxZ(room) + 1, me)
      if (w.type === 'map') w.place = String(room.meta.get('place') ?? '')
      room.doc.transact(() => {
        room.widgets.set(w.id, w)
        pushFeed(room, me, `added ${LABEL[type]}`)
      })
      return w.id
    },
    moveWidget(id: string, x: number, y: number) {
      const w = room.widgets.get(id)
      if (w) room.widgets.set(id, { ...w, x: snap(x), y: snap(y), z: maxZ(room) + 1 })
    },
    resizeWidget(id: string, width: number, height: number) {
      const w = room.widgets.get(id)
      if (w) room.widgets.set(id, { ...w, w: snap(width), h: snap(height) })
    },
    patchWidget(id: string, patch: Partial<Widget>) {
      const w = room.widgets.get(id)
      if (w) room.widgets.set(id, { ...w, ...patch } as Widget)
    },
    removeWidget(id: string) {
      room.doc.transact(() => {
        room.widgets.delete(id)
        for (const k of Array.from(room.votes.keys())) if (k.startsWith(`${id}|`)) room.votes.delete(k)
        for (const k of Array.from(room.checks.keys())) if (k.startsWith(`${id}|`)) room.checks.delete(k)
      })
    },

    /** One vote per option per session id: the key *is* the uniqueness constraint. */
    toggleVote(widgetId: string, optionId: string) {
      const key = `${widgetId}|${optionId}|${me.id}`
      room.doc.transact(() => {
        if (room.votes.has(key)) room.votes.delete(key)
        else {
          room.votes.set(key, Date.now())
          const w = room.widgets.get(widgetId)
          const opt = w?.type === 'vote' ? w.options.find((o) => o.id === optionId)?.text : undefined
          if (opt) pushFeed(room, me, `voted for ${opt}`)
        }
      })
    },
    toggleCheck(widgetId: string, itemId: string) {
      const key = `${widgetId}|${itemId}`
      room.checks.set(key, !room.checks.get(key))
    },

    addDay() {
      const days = Array.from(room.days.values())
      const n = days.length + 1
      const d: Day = { id: newId('d_'), n, date: `day ${n}`, title: 'new day' }
      room.days.set(d.id, d)
    },
    addStop(dayId: string, s: Pick<Stop, 'time' | 'title' | 'sub' | 'icon'>) {
      const orders = Array.from(room.stops.values()).filter((x) => x.dayId === dayId).map((x) => x.order)
      const stop: Stop = { id: newId('s_'), dayId, order: Math.max(0, ...orders) + 10, ...s }
      room.doc.transact(() => {
        room.stops.set(stop.id, stop)
        pushFeed(room, me, `added ${s.title} to the plan`)
      })
    },
    removeStop(id: string) {
      room.stops.delete(id)
    },
    /** Atomic move: a single set() changes dayId + order together, so concurrent drags can't duplicate a stop. */
    moveStop(stopId: string, toDayId: string, index: number) {
      const stop = room.stops.get(stopId)
      if (!stop) return
      const siblings = Array.from(room.stops.values())
        .filter((s) => s.dayId === toDayId && s.id !== stopId)
        .sort((a, b) => a.order - b.order)
      const prev = siblings[index - 1]?.order
      const next = siblings[index]?.order
      const order =
        prev === undefined && next === undefined ? 10 : prev === undefined ? next! - 10 : next === undefined ? prev + 10 : (prev + next) / 2
      room.stops.set(stopId, { ...stop, dayId: toDayId, order })
    },

    addExpense(e: Omit<Expense, 'id' | 'createdAt'>) {
      const exp: Expense = { ...e, id: newId('e_'), createdAt: Date.now() }
      room.doc.transact(() => {
        room.expenses.set(exp.id, exp)
        pushFeed(room, me, `added an expense: ${e.title}`)
      })
    },
    removeExpense(id: string) {
      room.expenses.delete(id)
    },
    togglePaid(key: string) {
      room.paid.set(key, !room.paid.get(key))
    },
  }
}
export type Actions = ReturnType<typeof makeActions>
