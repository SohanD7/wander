import { DndContext, PointerSensor, useDraggable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { GRID } from '../../collab/actions'
import { useTrip, usePeers, useYMap } from '../../collab/TripProvider'
import type { Widget, WidgetType } from '../../collab/types'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Pin } from '../../components/brand/Pin'
import type { IconName } from '../../icons/figmaIcons'
import { PromptToTrip } from '../ai/PromptToTrip'
import { toneBg } from '../../components/ui/Avatar'
import { BudgetBody, ChecklistBody, MapBody, NoteBody, VoteBody } from './Widgets'

const ADD: { type: WidgetType; label: string; icon: IconName }[] = [
  { type: 'vote', label: 'vote', icon: 'vote' },
  { type: 'budget', label: 'budget', icon: 'budget' },
  { type: 'note', label: 'note', icon: 'note' },
  { type: 'checklist', label: 'list', icon: 'checklist' },
  { type: 'map', label: 'map', icon: 'map' },
]
const SURFACE: Record<WidgetType, string> = { vote: 'bg-cream', budget: 'bg-cream', note: 'bg-sun', checklist: 'bg-cream', map: 'bg-cream' }
const DEFAULT_W = 360
const MIN_W = 240
const MIN_H = 144

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
        </div>
      </div>
      <button type="button" onClick={() => setAi(true)} aria-label="plan it for me"
        className="group absolute bottom-24 right-4 z-40 flex flex-col items-end gap-1 sm:bottom-6 sm:right-6">
        <span className="relative rounded-pill bg-cream px-4 py-2 text-sm font-semibold lowercase shadow-float transition group-hover:bg-sun">
          plan it for me
          <span className="absolute -bottom-1.5 right-6 h-3 w-3 rotate-45 bg-cream shadow-float transition group-hover:bg-sun [clip-path:polygon(100%_0,100%_100%,0_100%)]" />
        </span>
        <Pin size={72} className="mr-2 origin-bottom drop-shadow-md group-hover:[animation:wander-pin-bob_0.9s_ease-in-out_infinite] motion-reduce:group-hover:[animation:none]" />
      </button>
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
  const box = useRef<HTMLElement | null>(null)
  // live size while the corner handle is held; committed (snapped) to the shared doc on release
  const [live, setLive] = useState<{ w: number; h: number } | null>(null)
  const size = live ?? { w: w.w ?? DEFAULT_W, h: w.h }

  const startResize = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const from = { x: e.clientX, y: e.clientY, w: box.current?.offsetWidth ?? DEFAULT_W, h: box.current?.offsetHeight ?? MIN_H }
    let last = { w: from.w, h: from.h }
    const move = (ev: globalThis.PointerEvent) => {
      last = { w: Math.max(MIN_W, from.w + ev.clientX - from.x), h: Math.max(MIN_H, from.h + ev.clientY - from.y) }
      setLive(last)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      actions.resizeWidget(w.id, last.w, last.h)
      setLive(null)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const style: CSSProperties = {
    left: w.x,
    top: w.y,
    zIndex: isDragging || live ? 999 : w.z,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    ...(draggable ? { width: size.w, height: size.h } : { height: w.type === 'map' ? 320 : undefined }),
  }
  return (
    <section
      ref={(el) => { setNodeRef(el); box.current = el }}
      style={style}
      className={`group relative flex w-full flex-col rounded-card p-4 shadow-card sm:absolute ${SURFACE[w.type]} ${isDragging || live ? 'shadow-float' : ''}`}
    >
      <div className="mb-2 flex shrink-0 items-center justify-between">
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
      {w.type === 'map' ? (
        <div className="flex min-h-0 flex-1 flex-col"><MapBody w={w} /></div>
      ) : (
        <ScaleToFit enabled={draggable} fixedHeight={size.h !== undefined}>
          {w.type === 'vote' && <VoteBody w={w} />}
          {w.type === 'budget' && <BudgetBody w={w} />}
          {w.type === 'note' && <NoteBody w={w} />}
          {w.type === 'checklist' && <ChecklistBody w={w} />}
        </ScaleToFit>
      )}
      {draggable && (
        <button
          onPointerDown={startResize}
          aria-label="resize widget"
          className="absolute bottom-1 right-1 flex h-5 w-5 cursor-nwse-resize touch-none items-end justify-end p-0.5 text-ink/30 opacity-0 transition hover:text-ink/60 group-hover:opacity-100"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M9 1L1 9M9 5L5 9" /></svg>
        </button>
      )}
    </section>
  )
}

/** content width inside a default 360px card (minus p-4 padding) */
const BASE_W = DEFAULT_W - 32

/**
 * Resized widgets zoom their content instead of reflowing it: the body is always laid out at the
 * default width, then scaled to fill the card (and to fit its height, when the card has one).
 */
function ScaleToFit({ enabled, fixedHeight, children }: { enabled: boolean; fixedHeight: boolean; children: ReactNode }) {
  const area = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState<{ aw: number; ah: number; nh: number } | null>(null)

  useLayoutEffect(() => {
    if (!enabled || !area.current || !content.current) return
    const a = area.current
    const c = content.current
    const ro = new ResizeObserver(() => setDims({ aw: a.clientWidth, ah: a.clientHeight, nh: c.offsetHeight }))
    ro.observe(a)
    ro.observe(c)
    return () => ro.disconnect()
  }, [enabled])

  if (!enabled) return <div>{children}</div>
  const s = !dims?.nh ? 1 : Math.min(3, Math.max(0.5, fixedHeight ? Math.min(dims.aw / BASE_W, dims.ah / dims.nh) : dims.aw / BASE_W))
  return (
    <div ref={area} className={`relative min-h-0 overflow-hidden ${fixedHeight ? 'flex-1' : ''}`} style={!fixedHeight && dims ? { height: dims.nh * s } : undefined}>
      <div ref={content} style={{ width: BASE_W, transform: `scale(${s})`, transformOrigin: 'top left', marginLeft: dims ? Math.max(0, (dims.aw - BASE_W * s) / 2) : 0 }}>
        {children}
      </div>
    </div>
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
      <p className="mt-2 text-ink/65">start voting, jot down a note, or create a check list - or let wander draft the whole trip based on your preferences.</p>
      <Button className="mt-5" onClick={onAi}>plan it for me</Button>
    </div>
  )
}
