import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Logo } from '../../components/brand/Wordmark'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { lastName, useSession } from '../../lib/session'

type Mode = 'sign up' | 'sign in'

/**
 * MOCK AUTH — a username prompt, nothing more. A session is a random id kept in sessionStorage
 * (one identity per browser tab, so two tabs can play two people). No passwords, no server.
 * Deviation from Figma: the guest option asks for a display name, since cursors/votes need one.
 */
export function AuthPage() {
  const { session, signIn } = useSession()
  const nav = useNavigate()
  const [params] = useSearchParams()
  // the landing hero's "start a trip" always shows this page, even for someone already signed in
  const showAuth = !!(useLocation().state as { showAuth?: boolean } | null)?.showAuth
  const next = params.get('next')
  const [mode, setMode] = useState<Mode>('sign up')
  const [name, setName] = useState(lastName())
  const [email, setEmail] = useState('')
  // Only bounce people who arrive already signed in; a fresh sign-up navigates itself (to onboarding).
  const [arrivedSignedIn] = useState(!!session)

  if (session && arrivedSignedIn && !showAuth) return <Navigate to={next ?? '/trips'} replace />

  const go = (guest: boolean) => (e?: FormEvent) => {
    e?.preventDefault()
    if (!name.trim()) return
    signIn({ name: name.trim(), email: guest ? undefined : email.trim() || undefined, guest, fresh: mode === 'sign up' })
    nav(next ?? (mode === 'sign up' && !guest ? '/onboarding' : '/trips'), { replace: true })
  }

  return (
    <main className="bg-dot-grid flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <Link to="/"><Logo height={48} /></Link>
      <form onSubmit={go(false)} className="w-full max-w-md space-y-5 rounded-panel bg-cream p-6 shadow-float sm:p-8">
        <div className="flex gap-2 rounded-pill bg-sun p-1">
          {(['sign up', 'sign in'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`h-10 flex-1 rounded-pill text-sm font-semibold transition ${mode === m ? 'bg-sea text-cream' : 'text-ink/70'}`}
            >
              {m}
            </button>
          ))}
        </div>
        <Field label="your name" value={name} onChange={(e) => setName(e.target.value)} placeholder="maya" autoFocus required />
        <Field label="email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" />
        <Button type="submit" className="w-full" disabled={!name.trim()}>{mode}</Button>
        <div className="flex items-center gap-3 text-xs text-ink/50"><span className="h-px flex-1 bg-ink/15" />or<span className="h-px flex-1 bg-ink/15" /></div>
        <Button type="button" variant="ghost" className="w-full" disabled={!name.trim()} onClick={() => go(true)()}>continue as guest</Button>
        <p className="text-center text-xs text-ink/50">prototype — no real accounts. just pick a name.</p>
      </form>
    </main>
  )
}
