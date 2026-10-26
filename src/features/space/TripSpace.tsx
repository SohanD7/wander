import { DndContext, PointerSensor, useDraggable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { GRID } from '../../collab/actions'
import { useTrip, usePeers, useYMap } from '../../collab/TripProvider'
import type { Widget, WidgetType } from '../../collab/types'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import type { IconName } from '../../icons/figmaIcons'
import { PromptToTrip } from '../ai/PromptToTrip'
import { toneBg } from '../../components/ui/Avatar'
import { BudgetBody, ChecklistBody, NoteBody, VoteBody } from './Widgets'

const ADD: { type: WidgetType; label: string; icon: IconName }[] = [
  { type: 'vote', label: 'poll', icon: 'vote' },
  { type: 'budget', label: 'budget', icon: 'budget' },
  { type: 'note', label: 'note', icon: 'note' },
  { type: 'checklist', label: 'list', icon: 'checklist' },
]
const SURFACE: Record<WidgetType, string> = { vote: 'bg-cream', budget: 'bg-cream', note: 'bg-sun', checklist: 'bg-cream' }

function useIsDesktop() {
  const q = '(min-width: 640px)'
  const [v, setV] = useState(() => matchMedia(q).matches)
  useEffect(() => {
    const m = matchMedia(q)
    const on = () => setV(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return v
}

/** Figma: "Trip Space" — a shared dot-grid canvas. Desktop = free positioning; phones = stacked column. */
export function TripSpace() {
  const { room, actions } = useTrip()
  const widgets = Object.values(useYMap(room.widgets)).sort((a, b) => a.z - b.z)
  const desktop = useIsDesktop()
  const [ai, setAi] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const inner = useRef<HTMLDivElement>(null)
  const raf = useRef(0)

  const onDragEnd = ({ active, delta }: DragEndEvent) => {
    const w = room.widgets.get(String(active.id))
    if (w) actions.moveWidget(w.id, Math.max(0, w.x + delta.x), Math.max(0, w.y + delta.y))
  }

  // Live cursor → awareness, in canvas coordinates so it lines up for everyone regardless of scroll.
  const onMove = (e: PointerEvent) => {
    if (!inner.current || e.pointerType === 'touch') return
    const r = inner.current.getBoundingClientRect()
    const cursor = { x: e.clientX - r.left, y: e.clientY - r.top }
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => room.awareness.setLocalStateField('cursor', cursor))
  }
  const onLeave = () => room.awareness.setLocalStateField('cursor', null)

  return (
    <div className="relative h-full">
      <div className="scrollbar-none h-full overflow-auto">
        <div
          ref={inner}
          onPointerMove={onMove}
          onPointerLeave={onLeave}
          className="bg-dot-grid relative flex flex-col gap-4 p-4 pb-32 sm:block sm:h-[1100px] sm:min-w-[1600px] sm:p-0"
        >
          <DndContext sensors={sensors} onDragEnd={onDragEnd} modifiers={[snapToGrid]}>
            {widgets.map((w) => <DraggableWidget key={w.id} w={w} draggable={desktop} />)}
          </DndContext>
          {desktop && <Cursors />}
          {widgets.length === 0 && <Empty onAi={() => setAi(true)} />}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-3">
        <div className="pointer-events-auto flex items-center gap-1 rounded-pill bg-cream p-1.5 shadow-float">
          {ADD.map((a) => (
            <button key={a.type} onClick={() => actions.addWidget(a.type)} aria-label={`add ${a.label}`}
              className="inline-flex h-11 items-center gap-1.5 rounded-pill px-3 text-sm font-semibold lowercase text-ink/80 transition hover:bg-sun sm:px-4">
              <Icon name={a.icon} size={20} /><span className="hidden sm:inline">{a.label}</span>
            </button>
          ))}
          <span className="mx-1 h-6 w-px bg-ink/15" />
          <Button small variant="primary" onClick={() => setAi(true)}>plan it for me</Button>
        </div>
      </div>
      <PromptToTrip open={ai} onOpenChange={setAi} />
    </div>
  )
}

const snapToGrid = ({ transform }: { transform: { x: number; y: number; scaleX: number; scaleY: number } }) => ({
  ...transform,
  x: Math.round(transform.x / GRID) * GRID,
  y: Math.round(transform.y / GRID) * GRID,
})

function DraggableWidget({ w, draggable }: { w: Widget; draggable: boolean }) {
  const { actions } = useTrip()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: w.id, disabled: !draggable })
  const style: CSSProperties = {
    left: w.x,
    top: w.y,
    zIndex: isDragging ? 999 : w.z,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
  }
  return (
    <section
      ref={setNodeRef}
      style={style}
      className={`group w-full rounded-card p-4 shadow-card sm:absolute sm:w-[360px] ${SURFACE[w.type]} ${isDragging ? 'shadow-float' : ''}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <button
          {...listeners}
          {...attributes}
          aria-label="drag widget"
          className={`-ml-1 rounded-full px-1 text-ink/35 touch-none ${draggable ? 'cursor-grab active:cursor-grabbing' : 'hidden'}`}
        >⋮⋮</button>
        <button onClick={() => actions.removeWidget(w.id)} aria-label="delete widget" className="ml-auto rounded-full p-1 text-ink/40 opacity-100 hover:bg-ink/10 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100">
          <Icon name="close" size={16} />
        </button>
      </div>
      {w.type === 'vote' && <VoteBody w={w} />}
      {w.type === 'budget' && <BudgetBody w={w} />}
      {w.type === 'note' && <NoteBody w={w} />}
      {w.type === 'checklist' && <ChecklistBody w={w} />}
    </section>
  )
}

function Cursors() {
  const peers = usePeers().filter((p) => !p.isMe && p.cursor)
  return (
    <>
      {peers.map((p) => (
        <div key={p.clientId} className="pointer-events-none absolute z-[1000] transition-transform duration-75" style={{ transform: `translate(${p.cursor!.x}px, ${p.cursor!.y}px)` }}>
          <svg width="18" height="22" viewBox="0 0 18 22" fill={toneBg(p.user.tone)} stroke="#fffaea" strokeWidth="1.5"><path d="M1 1l15 8.5-6.5 1.8L6.8 19z" /></svg>
          <span className="ml-3 -mt-1 inline-block rounded-pill px-2 py-0.5 text-xs font-semibold text-cream" style={{ background: toneBg(p.user.tone) }}>{p.user.name}</span>
        </div>
      ))}
    </>
  )
}

function Empty({ onAi }: { onAi: () => void }) {
  return (
    <div className="absolute inset-x-0 top-24 mx-auto w-[min(420px,90%)] rounded-panel bg-cream p-8 text-center shadow-card">
      <h2 className="text-2xl font-semibold lowercase">a blank canvas</h2>
      <p className="mt-2 text-ink/65">add a poll, note or list from the bar below — or let wander draft the whole trip.</p>
      <Button className="mt-5" onClick={onAi}>plan it for me</Button>
    </div>
  )
}
