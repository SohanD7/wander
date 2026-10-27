import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Logo } from '../../components/brand/Wordmark'
import { Pin, PinProgress } from '../../components/brand/Pin'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import type { TripType } from '../../collab/types'
import { wipeTripRoom } from '../../collab/wipe'
import { useSession } from '../../lib/session'
import { baseId, demoRoomId, demoTrips, isDemoBase, readTrips, removeTrip, saveTrip, tripSlug, type TripRef } from '../../lib/trips'

const TYPES: { id: TripType; icon: 'sun' | 'car' | 'plane' }[] = [
  { id: 'day trip', icon: 'sun' },
  { id: 'road trip', icon: 'car' },
  { id: 'flight trip', icon: 'plane' },
]

export function MyTrips() {
  const { session, signOut } = useSession()
  const [open, setOpen] = useState(false)
  const [, refresh] = useState(0)
  const [doomed, setDoomed] = useState<TripRef | null>(null)
  const mine = readTrips()
  // demos are private per-visitor copies (id `<demo>~<session>`); hide the ones already in "my trips"
  const demos = demoTrips()
    .filter((d) => !mine.some((m) => baseId(m.id) === d.id))
    .map((d) => ({ ...d, id: session ? demoRoomId(d.id, session.id) : d.id }))

  return (
    <main className="bg-dot-grid min-h-dvh">
      <header className="flex h-topbar items-center justify-between px-5 sm:px-12">
        <Link to="/"><Logo /></Link>
        <div className="flex items-center gap-3">
          {session && <Avatar name={session.name} tone={session.tone} />}
          <Button small variant="ghost" onClick={signOut}>sign out</Button>
        </div>
      </header>
      <section className="mx-auto max-w-5xl px-5 pb-16 pt-4 sm:px-12">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-3xl font-semibold lowercase">my trips</h1>
          <Button onClick={() => setOpen(true)}><Icon name="plus" size={18} /> new trip</Button>
        </div>
        {mine.length > 0 ? <TripGrid trips={mine} onDelete={setDoomed} /> : (
          <div className="flex flex-col items-center gap-4 rounded-card bg-cream px-6 py-14 text-center shadow-card">
            <Pin size={72} />
            <div>
              <div className="text-xl font-semibold lowercase">no trips yet</div>
              <p className="mt-1 text-sm text-ink/60">start one and invite your crew — or poke around a demo below.</p>
            </div>
            <Button onClick={() => setOpen(true)}><Icon name="plus" size={18} /> start a trip</Button>
          </div>
        )}
        <h2 className="mb-3 mt-10 text-lg font-semibold lowercase text-ink/60">
          demo trips <span className="ml-1 text-sm font-normal text-ink/40">(these will get added to your trips once you start planning)</span>
        </h2>
        <TripGrid trips={demos} />
      </section>
      <NewTrip open={open} onOpenChange={setOpen} />
      <DeleteTrip trip={doomed} onClose={() => setDoomed(null)} onDone={() => { setDoomed(null); refresh((n) => n + 1) }} />
    </main>
  )
}

function TripGrid({ trips, onDelete }: { trips: TripRef[]; onDelete?: (t: TripRef) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {trips.map((t) => (
        <div key={t.id} className="relative">
          <Link to={`/t/${t.id}`} className="group block rounded-card bg-cream p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-float">
            <div className="mb-8 flex h-10 w-10 items-center justify-center rounded-full bg-sea text-cream">
              <Icon name={t.type === 'road trip' ? 'car' : t.type === 'flight trip' ? 'plane' : 'sun'} size={20} />
            </div>
            <div className="pr-8 text-xl font-semibold lowercase">{t.name}</div>
            <div className="mt-1 flex items-center gap-1.5 text-sm text-ink/60"><Icon name="pin" size={14} />{t.place || t.type}</div>
          </Link>
          {onDelete && (
            <button type="button" aria-label={`delete ${t.name}`} onClick={() => onDelete(t)}
              className="absolute right-3 top-3 rounded-full p-2 text-ink/45 transition hover:bg-ink/10 hover:text-sunset focus-visible:text-sunset">
              <Trash2 size={18} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/** Delete = forget it from my trips; if it's mine (created here, or my demo copy) also wipe it for everyone in it. */
function DeleteTrip({ trip, onClose, onDone }: { trip: TripRef | null; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const demo = !!trip && isDemoBase(baseId(trip.id))
  const go = async () => {
    if (!trip) return
    setBusy(true)
    try {
      if (trip.owned) await wipeTripRoom(trip.id, !demo)
    } finally {
      removeTrip(trip.id)
      setBusy(false)
      onDone()
    }
  }
  return (
    <Modal open={!!trip} onOpenChange={(o) => !o && !busy && onClose()} title={demo ? 'reset demo trip?' : trip?.owned ? 'delete this trip?' : 'remove this trip?'}>
      <p className="text-sm text-ink/70">
        {demo
          ? <>“{trip?.name}” goes back to the demo trips below and starts fresh the next time you open it.</>
          : trip?.owned
            ? <>“{trip?.name}” and everything in it (votes, itinerary, expenses) will be deleted for everyone on the trip. this can’t be undone.</>
            : <>“{trip?.name}” disappears from your trips. it stays for everyone else on it, and you can rejoin with the invite link.</>}
      </p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>cancel</Button>
        <Button onClick={go} disabled={busy}>{busy ? 'working…' : demo ? 'reset' : trip?.owned ? 'delete trip' : 'remove'}</Button>
      </div>
    </Modal>
  )
}

const VIBES = ['busy city', 'foodie', 'nightlife', 'art & museums', 'shopping', 'hidden gems', 'slow & cozy', 'history']
const PAST_CREW = ['Jordan', 'Priya', 'Sam']

/** Figma "Create New Trip": 1 basics (name, type, dates) → 2 destination + vibes → 3 crew. */
function NewTrip({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const nav = useNavigate()
  const [step, setStep] = useState(0)
  const [type, setType] = useState<TripType>('flight trip')
  const [name, setName] = useState('')
  const [place, setPlace] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [vibes, setVibes] = useState<string[]>([])
  const [crew, setCrew] = useState<string[]>([])
  const [email, setEmail] = useState('')
  const [emails, setEmails] = useState<string[]>([])
  const toggle = (l: string[], v: string) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v])

  const reset = () => { setStep(0); setName(''); setPlace(''); setStart(''); setEnd(''); setVibes([]); setCrew([]); setEmails([]); setEmail('') }
  /** `invited` override lets "skip" on the crew step create the trip with nobody added */
  const create = (invited = [...crew, ...emails]) => {
    const id = tripSlug(name)
    saveTrip({ id, name: name.trim(), type, place: place.trim(), start, end, vibes, invited, owned: true })
    onOpenChange(false)
    reset()
    nav(`/t/${id}`)
  }
  const chip = (on: boolean) => `h-10 rounded-pill border-2 px-4 text-sm font-semibold lowercase transition ${on ? 'border-ink bg-ink text-cream' : 'border-ink/60 text-ink hover:bg-white'}`

  return (
    <Modal open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }} title={['start a new trip', 'where to?', 'bring your crew'][step]}>
      <PinProgress className="mb-4" step={step} total={3} />
      {step === 0 && (
        <div className="space-y-4">
          <Field label="trip name" value={name} onChange={(e) => setName(e.target.value)} placeholder="tokyo spring break" autoFocus />
          <div>
            <span className="mb-1.5 block text-sm font-medium lowercase text-ink/70">trip type</span>
            <div className="flex flex-wrap gap-2">{TYPES.map((t) => <button key={t.id} type="button" onClick={() => setType(t.id)} aria-pressed={type === t.id} className={chip(type === t.id)}>{t.id}</button>)}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            <Field label="end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
      )}
      {step === 1 && (
        <div className="space-y-4">
          <Field label="destination" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="tokyo, japan" autoFocus />
          <div>
            <span className="mb-1.5 block text-sm font-medium lowercase text-ink/70">trip vibes</span>
            <div className="flex flex-wrap gap-2">{VIBES.map((v) => <button key={v} type="button" onClick={() => setVibes(toggle(vibes, v))} aria-pressed={vibes.includes(v)} className={chip(vibes.includes(v))}>{v}</button>)}</div>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <span className="mb-2 block text-sm font-medium lowercase text-ink/70">from past trips</span>
            <ul className="space-y-2">
              {PAST_CREW.map((n) => (
                <li key={n} className="flex items-center justify-between">
                  <span className="flex items-center gap-3 font-semibold"><Avatar name={n} tone={n === 'Jordan' ? 'sea' : n === 'Priya' ? 'ink' : 'sun'} />{n}</span>
                  <button type="button" onClick={() => setCrew(toggle(crew, n))} className={`h-9 rounded-pill px-4 text-sm font-semibold ${crew.includes(n) ? 'bg-sea text-cream' : 'border-2 border-ink/60'}`}>{crew.includes(n) ? '✓ added' : '+ add'}</button>
                </li>
              ))}
            </ul>
          </div>
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (email.trim()) { setEmails([...emails, email.trim()]); setEmail('') } }}>
            <div className="flex-1"><Field label="invite by email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="friend@email.com" /></div>
            <Button type="submit" variant="ghost">invite</Button>
          </form>
          {emails.length > 0 && <p className="text-xs text-ink/60">invited: {emails.join(', ')}</p>}
          <p className="text-xs text-ink/50">prototype: no emails are sent — share the trip link from inside the trip.</p>
        </div>
      )}
      <div className="mt-6 flex justify-between">
        <Button variant="ghost" onClick={() => (step === 0 ? onOpenChange(false) : setStep(step - 1))}>{step === 0 ? 'cancel' : 'back'}</Button>
        <div className="flex gap-2">
          {step > 0 && <Button variant="ghost" onClick={() => (step === 1 ? (setPlace(''), setVibes([]), setStep(2)) : create([]))}>skip</Button>}
          {step < 2 ? <Button disabled={step === 0 && !name.trim()} onClick={() => setStep(step + 1)}>next</Button> : <Button onClick={() => create()}>create trip</Button>}
        </div>
      </div>
    </Modal>
  )
}
