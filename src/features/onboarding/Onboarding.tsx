import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Logo } from '../../components/brand/Wordmark'
import { PinProgress } from '../../components/brand/Pin'
import { useSession } from '../../lib/session'

const STYLES = ['beach', 'hiking', 'food', 'road trips', 'city', 'nightlife', 'culture', 'chill']
const KEY = 'wander.profile.v1'

/** 2-step wizard. Answers go to localStorage only (prototype) — ends on the preferences step. */
export function Onboarding() {
  const { session } = useSession()
  const nav = useNavigate()
  const [step, setStep] = useState(0)
  const [styles, setStyles] = useState<string[]>([])

  const finish = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ styles }))
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
  ]

  return (
    <main className="bg-dot-grid flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <Logo height={48} />
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
