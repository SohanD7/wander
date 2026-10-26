import { Link } from 'react-router-dom'
import { Logo, Sprite } from '../../components/brand/Wordmark'
import { Button } from '../../components/ui/Button'
import { useSession } from '../../lib/session'

/** PLACEHOLDER — Figma frame 79:2 "wander — Landing Page" (nav, hero, group-chat, features, vibes, app-preview, cta, footer) is not built yet. */
export function Landing() {
  const { session } = useSession()
  return (
    <main className="bg-dot-grid flex min-h-dvh flex-col">
      <header className="flex h-topbar items-center justify-between px-6 sm:px-12">
        <Logo />
        <Link to={session ? '/trips' : '/start'}>
          <Button small variant="cream">{session ? 'my trips' : 'sign in'}</Button>
        </Link>
      </header>
      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-6 pb-20 text-center">
        <Sprite size={168} />
        <h1 className="text-4xl font-semibold lowercase leading-tight text-ink sm:text-6xl">plan trips together, in real time</h1>
        <p className="max-w-xl text-lg text-ink/70">polls, notes, a shared itinerary and a budget — on one canvas your whole crew can edit at once.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link to="/start"><Button>start planning</Button></Link>
          <Link to="/t/pch-roadtrip"><Button variant="sea">try the demo trip</Button></Link>
        </div>
      </section>
    </main>
  )
}
