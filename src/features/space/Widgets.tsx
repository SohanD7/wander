import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTrip, useYMap } from '../../collab/TripProvider'
import type { BudgetWidget, ChecklistWidget, MapWidget, NoteWidget, VoteWidget } from '../../collab/types'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { useSession } from '../../lib/session'
import { money, total } from '../../lib/settle'
import { DealsModal } from '../budget/DealsModal'

/* Figma: "vote" / "budget" / "note" / "checklist" / "map" widgets on the Trip Space canvas. */

export function VoteBody({ w }: { w: VoteWidget }) {
  const { room, actions } = useTrip()
  const { session } = useSession()
  const votes = useYMap(room.votes)
  const [draft, setDraft] = useState('')

  const mine = (o: string) => !!votes[`${w.id}|${o}|${session?.id}`]
  const count = (o: string) => Object.keys(votes).filter((k) => k.startsWith(`${w.id}|${o}|`)).length
  const voters = new Set(Object.keys(votes).filter((k) => k.startsWith(`${w.id}|`)).map((k) => k.split('|')[2])).size
  const max = Math.max(1, ...w.options.map((o) => count(o.id)))

  return (
    <div className="space-y-3">
      <input value={w.question} onChange={(e) => actions.patchWidget(w.id, { question: e.target.value })} placeholder="vote on..." aria-label="vote question" className="w-full bg-transparent text-lg font-semibold lowercase leading-snug placeholder:text-ink/40" />
      <ul className="space-y-2">
        {w.options.map((o, i) => {
          const n = count(o.id)
          return (
            <li key={o.id} className={`group relative flex h-12 items-center gap-1 overflow-hidden rounded-pill border-2 pr-1.5 pl-4 transition ${mine(o.id) ? 'border-sea bg-white' : 'border-transparent bg-white/70 hover:border-sea/40'}`}>
              <span className="pointer-events-none absolute inset-y-0 left-0 bg-sea/25 transition-all" style={{ width: `${(n / max) * 100}%` }} />
              <input
                value={o.text}
                onChange={(e) => actions.patchWidget(w.id, { options: w.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })}
                placeholder={`option ${['one', 'two', 'three', 'four', 'five'][i] ?? i + 1}`}
                aria-label={`option ${i + 1}`}
                className="relative min-w-0 flex-1 bg-transparent text-sm font-semibold lowercase placeholder:text-ink/40"
              />
              <button
                onClick={() => actions.toggleVote(w.id, o.id)}
                aria-pressed={mine(o.id)}
                aria-label={`vote for ${o.text || `option ${i + 1}`}`}
                className="relative flex h-8 items-center gap-1 rounded-pill px-2.5 text-sm font-semibold tabular-nums hover:bg-sea/20"
              >
                {mine(o.id) && <Icon name="check" size={16} />}{n}
              </button>
              <button
                onClick={() => actions.removeVoteOption(w.id, o.id)}
                aria-label={`delete ${o.text || `option ${i + 1}`}`}
                className="relative rounded-full px-2 text-ink/35 hover:bg-ink/10 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              >
                ×
              </button>
            </li>
          )
        })}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const text = draft.trim()
          if (!text) return
          actions.patchWidget(w.id, { options: [...w.options, { id: `o_${Date.now().toString(36)}`, text }] })
          setDraft('')
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="add an option" className="h-9 min-w-0 flex-1 rounded-pill bg-white/70 px-4 text-sm" />
        <Button small variant="cream" type="submit" aria-label="add option"><Icon name="plus" size={14} /></Button>
      </form>
      <p className="text-xs text-ink/55">{voters} of {Math.max(w.eligible, voters)} voted · {w.closes}</p>
    </div>
  )
}

export function BudgetBody({ w }: { w: BudgetWidget }) {
  void w
  const { room } = useTrip()
  const meta = useYMap(room.meta)
  const expenses = Object.values(useYMap(room.expenses))
  const memberCount = Object.keys(useYMap(room.members)).length
  const members = new Set(expenses.flatMap((e) => e.splitAmong)).size || memberCount || 1
  const spent = total(expenses)
  const budget = Number(meta.budget) || 0
  const [deals, setDeals] = useState(false)

  return (
    <div className="space-y-3">
      <div>
        <div className="text-3xl font-semibold tabular-nums">{money(spent)}</div>
        <div className="text-sm text-ink/60">{budget ? `of ${money(budget)} budget` : 'spent so far'}</div>
      </div>
      {budget > 0 && (
        <div className="h-3 overflow-hidden rounded-full bg-white/70"><div className="h-full rounded-full bg-sunset transition-all" style={{ width: `${Math.min(100, (spent / budget) * 100)}%` }} /></div>
      )}
      <div className="flex justify-between text-sm"><span className="text-ink/60">about each</span><b className="tabular-nums">{money(spent / members)}</b></div>
      <div className="flex gap-2">
        <Link to="budget" className="flex-1"><Button small variant="sea" className="w-full">see full budget</Button></Link>
        <Button small variant="cream" onClick={() => setDeals(true)}>find deals</Button>
      </div>
      <DealsModal open={deals} onOpenChange={setDeals} />
    </div>
  )
}

export function NoteBody({ w }: { w: NoteWidget }) {
  const { actions } = useTrip()
  return (
    <div>
      <textarea
        value={w.text}
        onChange={(e) => actions.patchWidget(w.id, { text: e.target.value })}
        placeholder="write something for the crew…"
        rows={5}
        className="w-full resize-none rounded-2xl bg-transparent text-base leading-relaxed placeholder:text-ink/40"
      />
      <p className="mt-1 text-xs text-ink/55">— {w.author}</p>
    </div>
  )
}

export function ChecklistBody({ w }: { w: ChecklistWidget }) {
  const { room, actions } = useTrip()
  const checks = useYMap(room.checks)
  const [draft, setDraft] = useState('')
  const done = w.items.filter((i) => checks[`${w.id}|${i.id}`]).length
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <input value={w.title} onChange={(e) => actions.patchWidget(w.id, { title: e.target.value })} placeholder="list title..." aria-label="list title" className="min-w-0 flex-1 bg-transparent text-lg font-semibold lowercase placeholder:text-ink/40" />
        <span className="text-xs text-ink/55">{done}/{w.items.length}</span>
      </div>
      <ul className="space-y-1.5">
        {w.items.map((i) => {
          const on = !!checks[`${w.id}|${i.id}`]
          return (
            <li key={i.id} className="group flex items-center gap-3 text-sm">
              <input type="checkbox" checked={on} onChange={() => actions.toggleCheck(w.id, i.id)} aria-label={`check off ${i.text || 'item'}`} className="h-5 w-5 shrink-0 cursor-pointer accent-sea" />
              <input
                value={i.text}
                onChange={(e) => actions.patchWidget(w.id, { items: w.items.map((x) => (x.id === i.id ? { ...x, text: e.target.value } : x)) })}
                placeholder="first item"
                aria-label="list item"
                className={`min-w-0 flex-1 bg-transparent placeholder:text-ink/40 ${on ? 'text-ink/40 line-through' : ''}`}
              />
              <button
                onClick={() => actions.removeChecklistItem(w.id, i.id)}
                aria-label={`delete ${i.text || 'item'}`}
                className="rounded-full px-2 text-ink/35 hover:bg-ink/10 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              >
                ×
              </button>
            </li>
          )
        })}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const text = draft.trim()
          if (!text) return
          actions.patchWidget(w.id, { items: [...w.items, { id: `c_${Date.now().toString(36)}`, text }] })
          setDraft('')
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="add item" className="h-9 min-w-0 flex-1 rounded-pill bg-white/70 px-4 text-sm" />
        <Button small variant="cream" type="submit" aria-label="add item"><Icon name="plus" size={14} /></Button>
      </form>
    </div>
  )
}

/** Keyless Google Maps embed of a free-text place; anyone can retype the place for the whole group. */
export function MapBody({ w }: { w: MapWidget }) {
  const { actions } = useTrip()
  const [draft, setDraft] = useState(w.place)
  const commit = () => { if (draft.trim() !== w.place) actions.patchWidget(w.id, { place: draft.trim() }) }
  return (
    <>
      <form className="mb-3 flex shrink-0 items-center gap-2" onSubmit={(e) => { e.preventDefault(); commit() }}>
        <Icon name="pin" size={18} className="text-sea" />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} placeholder="search a place"
          className="h-9 min-w-0 flex-1 rounded-pill bg-white/70 px-4 text-sm lowercase" />
      </form>
      {w.place ? (
        <iframe title={`map of ${w.place}`} loading="lazy" className="min-h-0 w-full flex-1 rounded-2xl border-0 bg-white/70"
          src={`https://maps.google.com/maps?q=${encodeURIComponent(w.place)}&z=11&output=embed`} />
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-2xl bg-white/70 text-sm text-ink/50">type a place to drop a pin</div>
      )}
    </>
  )
}
