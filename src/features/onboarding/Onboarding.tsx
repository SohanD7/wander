import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Logo } from '../../components/brand/Wordmark'
import { PinProgress } from '../../components/brand/Pin'
import { useSession } from '../../lib/session'

const STYLES = ['beach', 'hiking', 'food', 'road trips', 'city', 'nightlife', 'culture', 'chill']
const KEY = 'wander.profile.v1'

/** 4-step wizard. Answers go to localStorage only (prototype) — step 3 is the availability calendar. */
export function Onboarding() {
  const { session } = useSession()
  const nav = useNavigate()
  const [step, setStep] = useState(0)
  const [styles, setStyles] = useState<string[]>([])
  const [days, setDays] = useState<string[]>([])

  const finish = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ styles, availability: days }))
    } catch { /* ignore */ }
    nav('/trips', { replace: true })
  }
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const steps = [
    <div key="0" className="space-y-3 text-center">
      <h1 className="text-3xl font-semibold lowercase">hey {session?.name} 👋</h1>
      <p className="text-ink/70">let’s get you set up — it takes about a minute.</p>
    </div>,
    <div key="1" className="space-y-4">
      <h1 className="text-2xl font-semibold lowercase">what do you like to do?</h1>
      <div className="flex flex-wrap gap-2">
        {STYLES.map((s) => (
          <button key={s} onClick={() => setStyles(toggle(styles, s))}
            className={`h-10 rounded-pill px-4 text-sm font-semibold transition ${styles.includes(s) ? 'bg-sea text-cream' : 'bg-white text-ink/70'}`}>{s}</button>
        ))}
      </div>
    </div>,
    <div key="2" className="space-y-4">
      <h1 className="text-2xl font-semibold lowercase">when are you free?</h1>
      <p className="text-sm text-ink/60">tap the days you can travel.</p>
      <AvailabilityCalendar value={days} onToggle={(d) => setDays(toggle(days, d))} />
    </div>,
    <div key="3" className="space-y-3 text-center">
      <h1 className="text-3xl font-semibold lowercase">you’re all set!</h1>
      <p className="text-ink/70">create a trip or open the demo to try it out.</p>
    </div>,
  ]

  return (
    <main className="bg-dot-grid flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <Logo height={40} />
      <div className="w-full max-w-md rounded-panel bg-cream p-6 shadow-float sm:p-8">
        <PinProgress className="mb-6" step={step} total={steps.length} />
        {steps[step]}
        <div className="mt-8 flex justify-between gap-3">
          <Button variant="ghost" onClick={() => (step === 0 ? finish() : setStep(step - 1))}>{step === 0 ? 'skip' : 'back'}</Button>
          <Button onClick={() => (step === steps.length - 1 ? finish() : setStep(step + 1))}>{step === steps.length - 1 ? 'let’s go' : 'next'}</Button>
        </div>
      </div>
    </main>
  )
}

function AvailabilityCalendar({ value, onToggle }: { value: string[]; onToggle: (iso: string) => void }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const y = cursor.getFullYear()
  const m = cursor.getMonth()
  const first = new Date(y, m, 1).getDay()
  const count = new Date(y, m + 1, 0).getDate()
  const cells = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)]
  const iso = (d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => setCursor(new Date(y, m - 1, 1))} className="h-8 w-8 rounded-full hover:bg-ink/10" aria-label="previous month">‹</button>
        <span className="font-semibold lowercase">{cursor.toLocaleString('en', { month: 'long', year: 'numeric' })}</span>
        <button onClick={() => setCursor(new Date(y, m + 1, 1))} className="h-8 w-8 rounded-full hover:bg-ink/10" aria-label="next month">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-ink/50">{'smtwtfs'.split('').map((c, i) => <span key={i}>{c}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => d === null ? <span key={i} /> : (
          <button key={i} onClick={() => onToggle(iso(d))}
            className={`aspect-square rounded-full text-sm transition ${value.includes(iso(d)) ? 'bg-sea font-semibold text-cream' : 'hover:bg-sun'}`}>{d}</button>
        ))}
      </div>
    </div>
  )
}
