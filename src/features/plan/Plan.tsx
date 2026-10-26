import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState } from 'react'
import { useTrip, useYMap } from '../../collab/TripProvider'
import type { Day, Stop } from '../../collab/types'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import type { IconName } from '../../icons/figmaIcons'
import { RouteTrack } from './RouteTrack'

const STOP_ICONS: IconName[] = ['pin', 'food', 'coffee', 'camera', 'mountain', 'car', 'home', 'ticket']

/**
 * Figma: "Itinerary". One column per day; stops drag between days (shared, so everyone sees it live).
 * Deviation from the requirements doc: the Figma frames use timed stops, not Morning/Afternoon/Evening slots.
 */
export function Plan() {
  const { room, actions } = useTrip()
  const days = Object.values(useYMap(room.days)).sort((a, b) => a.n - b.n)
  const stops = Object.values(useYMap(room.stops))
  const [adding, setAdding] = useState<string | null>(null)
  const [active, setActive] = useState<Stop | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  )

  const inDay = (id: string) => stops.filter((s) => s.dayId === id).sort((a, b) => a.order - b.order)

  const onStart = (e: DragStartEvent) => setActive(room.stops.get(String(e.active.id)) ?? null)
  const onEnd = ({ active: a, over }: DragEndEvent) => {
    setActive(null)
    if (!over) return
    const overId = String(over.id)
    const target = room.stops.get(overId)
    const toDay = target ? target.dayId : room.days.has(overId) ? overId : null
    if (!toDay) return
    const list = inDay(toDay).filter((s) => s.id !== a.id)
    const idx = target ? list.findIndex((s) => s.id === overId) : list.length
    // dropping on a stop in the same column: place it where that stop is
    actions.moveStop(String(a.id), toDay, idx < 0 ? list.length : idx)
  }

  if (days.length === 0)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <h2 className="text-2xl font-semibold lowercase">no plan yet</h2>
        <p className="text-ink/60">add a day, or head to the trip space and tap “plan it for me”.</p>
        <Button onClick={() => actions.addDay()}>add day 1</Button>
      </div>
    )

  return (
    <div className="bg-dot-grid scrollbar-none h-full overflow-auto p-4 sm:p-8">
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          {days.map((d) => <DayCard key={d.id} day={d} stops={inDay(d.id)} onAdd={() => setAdding(d.id)} />)}
          <button onClick={() => actions.addDay()} className="h-14 shrink-0 rounded-card border-2 border-dashed border-ink/25 px-6 text-sm font-semibold lowercase text-ink/60 hover:border-sea hover:text-sea sm:w-48">+ add day</button>
        </div>
        <DragOverlay>{active && <StopRow stop={active} floating />}</DragOverlay>
      </DndContext>
      <AddStop dayId={adding} onClose={() => setAdding(null)} />
    </div>
  )
}

function DayCard({ day, stops, onAdd }: { day: Day; stops: Stop[]; onAdd: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: day.id })
  return (
    <section ref={setNodeRef} className={`w-full shrink-0 rounded-card bg-cream p-4 shadow-card transition sm:w-[340px] ${isOver ? 'ring-2 ring-sea' : ''}`}>
      <header className="mb-3 flex items-baseline justify-between">
        <div><div className="text-xs font-semibold uppercase tracking-wide text-sunset">day {day.n}</div><div className="text-lg font-semibold lowercase">{day.title}</div></div>
        <div className="text-xs text-ink/55">{day.date}</div>
      </header>
      <div className="flex gap-3">
        <RouteTrack count={stops.length} />
        <SortableContext items={stops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="min-h-12 flex-1 space-y-2">{stops.map((s) => <SortableStop key={s.id} stop={s} />)}</ul>
        </SortableContext>
      </div>
      <button onClick={onAdd} className="mt-3 w-full rounded-pill bg-sun py-2 text-sm font-semibold lowercase text-ink/70 hover:bg-sea hover:text-cream">+ add stop</button>
    </section>
  )
}

function SortableStop({ stop }: { stop: Stop }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }} {...attributes} {...listeners} className="touch-manipulation">
      <StopRow stop={stop} />
    </li>
  )
}

function StopRow({ stop, floating }: { stop: Stop; floating?: boolean }) {
  const { actions } = useTrip()
  return (
    <div className={`group flex items-center gap-3 rounded-2xl bg-white p-3 ${floating ? 'shadow-float' : ''}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sea text-cream"><Icon name={stop.icon} size={18} /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold lowercase">{stop.title}</div>
        <div className="truncate text-xs text-ink/55">{stop.time} · {stop.sub}</div>
      </div>
      {!floating && (
        <button onPointerDown={(e) => e.stopPropagation()} onClick={() => actions.removeStop(stop.id)} aria-label={`remove ${stop.title}`} className="rounded-full p-1 text-ink/35 hover:bg-ink/10 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100">
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  )
}

function AddStop({ dayId, onClose }: { dayId: string | null; onClose: () => void }) {
  const { actions } = useTrip()
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('12:00p')
  const [sub, setSub] = useState('')
  const [icon, setIcon] = useState<IconName>('pin')
  const submit = () => {
    if (!dayId || !title.trim()) return
    actions.addStop(dayId, { title: title.trim(), time, sub: sub.trim(), icon })
    setTitle(''); setSub(''); setIcon('pin')
    onClose()
  }
  return (
    <Modal open={!!dayId} onOpenChange={(o) => !o && onClose()} title="add a stop">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <Field label="what" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="lunch in carmel" autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Field label="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <Field label="note" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="by-the-sea" />
        </div>
        <div className="flex flex-wrap gap-2">
          {STOP_ICONS.map((n) => (
            <button type="button" key={n} onClick={() => setIcon(n)} aria-label={n} aria-pressed={icon === n}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition ${icon === n ? 'bg-sea text-cream' : 'bg-white text-ink/70'}`}><Icon name={n} size={18} /></button>
          ))}
        </div>
        <Button type="submit" className="w-full" disabled={!title.trim()}>add stop</Button>
      </form>
    </Modal>
  )
}
