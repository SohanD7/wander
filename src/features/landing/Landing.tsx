import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import routeUrl from '../../assets/landing/route.svg'
import routeDotsUrl from '../../assets/landing/route-dots.svg'
import connectorUrl from '../../assets/landing/stop-connector.svg'
import { Pin } from '../../components/brand/Pin'
import { Logo, Sprite, Wordmark } from '../../components/brand/Wordmark'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import type { IconName } from '../../icons/figmaIcons'
import { lastName, useSession, type Tone } from '../../lib/session'

/**
 * Figma frame 79:2 "wander — Landing Page", minus its top nav:
 * hero → group-chat → features → vibes → app-preview → cta → footer.
 * Desktop matches the 1512px frame; the two "illustration" pieces (hero route, app preview)
 * are drawn at Figma size and scaled to fit, everything else reflows on smaller screens.
 */
export function Landing() {
  const { session, signIn } = useSession()
  const nav = useNavigate()
  // "continue as guest" skips the auth page: sign in as a guest and land on my trips (zero state + demo trips)
  const guest = () => {
    if (!session) signIn({ name: lastName() || 'guest', guest: true })
    nav('/trips')
  }
  // desktop is drawn at the 1512px Figma scale, then zoomed out so it reads like a normal web page
  return (
    <main className="overflow-x-clip bg-sun text-ink lg:[zoom:0.75]">
      <Hero onGuest={guest} />
      <GroupChat />
      <Features />
      <Vibes />
      <AppPreview />
      <Cta onGuest={guest} />
      <Footer />
    </main>
  )
}

/** Draws children at a fixed design size and scales them down to the available width. */
function FitWidth({ width, height, className = '', children }: { width: number; height: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [s, setS] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setS(Math.min(1, el.clientWidth / width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])
  return (
    <div ref={ref} className={className} style={{ height: height * s }}>
      <div className="relative" style={{ width, height, transform: `scale(${s})`, transformOrigin: 'top left' }}>{children}</div>
    </div>
  )
}

/** iMessage-style curled tail on a bubble's bottom corner (the bubble squares that corner off). */
function Tail({ size, fill, side = 'left' }: { size: number; fill: string; side?: 'left' | 'right' }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 20 20" className={`absolute bottom-0 ${fill} ${side === 'right' ? '-scale-x-100' : ''}`} style={{ [side]: -size / 2 }}>
      <path d="M10 0H20V20H0C6 18 10 12 10 0Z" />
    </svg>
  )
}

const PILL_BTN = 'inline-flex items-center justify-center rounded-pill px-7 py-4 text-lg font-semibold transition'

/* ── hero (79:14) ─────────────────────────────────────────────── */

const STOPS: { label: string; icon: IconName; circle: string; ink: string }[] = [
  { label: 'invite', icon: 'invite', circle: 'bg-sunset', ink: 'text-cream' },
  { label: 'vote', icon: 'vote', circle: 'bg-sea', ink: 'text-ink' },
  { label: 'plan', icon: 'cal', circle: 'bg-sunset', ink: 'text-cream' },
  { label: 'budget', icon: 'dollar', circle: 'bg-sea', ink: 'text-ink' },
]
/** the route graphic is cropped from the right of the 1512px frame (x 760 → 1512) */
const ROUTE_X = 760

function Hero({ onGuest }: { onGuest: () => void }) {
  return (
    <section className="mx-auto flex max-w-[1512px] flex-col gap-10 pt-16 lg:min-h-[820px] lg:flex-row lg:items-center lg:justify-between lg:gap-0 lg:pt-0">
      <div className="flex flex-col items-start gap-6 px-6 sm:px-12 lg:py-24 lg:pl-24 lg:pr-0">
        <span className="relative rounded-[20px] rounded-bl-none bg-sea px-[18px] py-2 text-base font-semibold">group trip planning, minus the chaos<Tail size={14} fill="fill-sea" /></span>
        <h1 className="text-[64px] font-bold leading-none sm:text-[96px] xl:text-[128px]">
          <span className="block">do it all</span>
          <span className="flex items-baseline gap-[0.11em]">with <Wordmark height={0} className="!h-auto w-[3.41em]" /></span>
        </h1>
        <p className="max-w-[600px] text-xl leading-[1.4] sm:text-2xl">
          the trip planner for friends who can never agree. invite your crew, vote on ideas, plan the days, and split the budget, all in one shared space.
        </p>
        <div className="flex flex-wrap gap-[14px]">
          <Link to="/start" state={{ showAuth: true }} className={`${PILL_BTN} relative rounded-bl-none bg-sunset text-cream hover:brightness-105`}>start a trip, it’s free<Tail size={18} fill="fill-sunset" /></Link>
          <button type="button" onClick={onGuest} className={`${PILL_BTN} border-2 border-ink hover:bg-ink/5`}>continue as guest</button>
        </div>
      </div>
      <FitWidth width={1512 - ROUTE_X} height={820} className="pointer-events-none w-full shrink-0 lg:w-[min(752px,50vw)]">
        <img src={routeUrl} alt="" className="absolute top-0 max-w-none" style={{ left: -ROUTE_X, width: 1512, height: 820 }} />
        <img src={routeDotsUrl} alt="" className="absolute top-0 max-w-none" style={{ left: -ROUTE_X, width: 1512, height: 820 }} />
        {/* carry the route's two ends off both edges of the screen so it reads as one line */}
        <span className="absolute h-[10px] w-[4000px] bg-ink" style={{ top: 75, left: 805 - ROUTE_X - 4000 }} />
        <span className="absolute h-[10px] w-[4000px] bg-ink" style={{ top: 785, left: 1140 - ROUTE_X }} />
        {STOPS.map((s, i) => (
          <div key={s.label} className="absolute flex items-center" style={{ left: 1030 - ROUTE_X, top: 200 + i * 140 }}>
            <span className={`flex size-[100px] items-center justify-center rounded-full ${s.circle} ${s.ink}`}><Icon name={s.icon} size={48} /></span>
            <span className="absolute left-[184px] text-[64px] font-semibold whitespace-nowrap">{s.label}</span>
          </div>
        ))}
      </FitWidth>
    </section>
  )
}

/* ── group chat (79:90) ───────────────────────────────────────── */

const CHAT = [
  { who: 'jordan', text: 'wait, which weekend are we doing??', bg: 'bg-sunset text-cream', fill: 'fill-sunset', rot: 3, side: 'left' as const, pos: 'lg:top-[14%] lg:right-[5%]' },
  { who: 'sam', text: 'can someone resend the airbnb link', bg: 'bg-sea', fill: 'fill-sea', rot: -2, side: 'right' as const, pos: 'lg:top-[30%] lg:left-[4%]' },
  { who: 'priya', text: 'how much do i owe you for gas 😅', bg: 'bg-sun', fill: 'fill-sun', rot: 2, side: 'left' as const, pos: 'lg:top-[58%] lg:right-[3%]' },
  { who: 'maya', text: 'ok but who’s actually driving', bg: 'bg-cream', fill: 'fill-cream', rot: -3, side: 'right' as const, pos: 'lg:top-[72%] lg:left-[7%]' },
]
const HEADLINE = 'the group chat\nisn’t a trip plan.'
const TYPE_MS = 75 // per character
const POP_EVERY = 600 // a new bubble pops up every 600ms while the headline types
const BUBBLE_HOLD = 1100 // how long each bubble stays before fading

/**
 * Every time the section scrolls into view, the headline types itself out and, while it
 * types, the chat bubbles pop up one by one and fade away. Scrolling away resets it.
 */
function GroupChat() {
  const section = useRef<HTMLElement>(null)
  const bubbles = useRef<(HTMLDivElement | null)[]>([])
  const [reduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [typed, setTyped] = useState(reduced ? HEADLINE.length : 0)

  useEffect(() => {
    const el = section.current
    if (!el || reduced) return
    const timers: number[] = []
    const reset = () => {
      timers.splice(0).forEach((t) => clearTimeout(t))
      bubbles.current.forEach((b) => b?.getAnimations().forEach((a) => a.cancel()))
      setTyped(0)
    }
    const play = () => {
      reset()
      for (let n = 1; n <= HEADLINE.length; n++) timers.push(window.setTimeout(() => setTyped(n), 300 + n * TYPE_MS))
      bubbles.current.forEach((b, i) => {
        const rot = CHAT[i].rot
        b?.animate(
          [
            { opacity: 0, transform: `translateY(24px) rotate(${rot}deg) scale(0.6)`, offset: 0 },
            { opacity: 1, transform: `translateY(-6px) rotate(${rot}deg) scale(1.06)`, offset: 0.12 },
            { opacity: 1, transform: `translateY(0) rotate(${rot}deg) scale(1)`, offset: 0.18 },
            { opacity: 1, transform: `translateY(0) rotate(${rot}deg) scale(1)`, offset: 0.7 },
            { opacity: 0, transform: `translateY(-10px) rotate(${rot}deg) scale(0.98)`, offset: 1 },
          ],
          { duration: BUBBLE_HOLD / 0.7, delay: 300 + i * POP_EVERY, easing: 'ease-out', fill: 'both' },
        )
      })
    }
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? play() : reset()), { threshold: 0.45 })
    io.observe(el)
    return () => { io.disconnect(); timers.splice(0).forEach((t) => clearTimeout(t)) }
  }, [reduced])

  const lines = HEADLINE.split('\n')
  const typing = typed > 0 && typed < HEADLINE.length
  return (
    <section ref={section} className="relative overflow-hidden bg-ink px-6 py-24 sm:px-12 lg:min-h-[780px] lg:py-0">
        <div aria-hidden className="pointer-events-none absolute inset-x-4 top-16 flex flex-col items-center gap-3 lg:inset-0 lg:block">
          {CHAT.map((c, i) => (
            <div
              key={c.who}
              ref={(el) => { bubbles.current[i] = el }}
              style={{ opacity: 0, transform: `rotate(${c.rot}deg)` }}
              className={`${c.bg} ${c.side === 'left' ? 'rounded-bl-none' : 'rounded-br-none'} ${c.pos} relative flex max-w-full flex-col gap-1 rounded-[40px] pt-6 pr-9 pb-[26px] pl-8 shadow-[0_14px_30px_rgb(66_47_14/0.3)] lg:absolute`}
            >
              <span className="text-[15px] font-medium">{c.who}</span>
              <span className="text-xl font-semibold sm:text-[30px] sm:whitespace-nowrap">{c.text}</span>
              <Tail size={26} fill={c.fill} side={c.side} />
            </div>
          ))}
        </div>
        <div className="relative mx-auto flex min-h-[520px] max-w-[760px] flex-col items-center justify-center gap-6 text-center lg:min-h-[780px]">
          <h2 aria-label={HEADLINE.replace('\n', ' ')} className="text-5xl font-bold leading-[1.05] text-sun sm:text-[76px]">
            {lines.map((line, li) => {
              const offset = li === 0 ? 0 : lines[0].length + 1
              return (
                <span key={li} aria-hidden className="block whitespace-nowrap">
                  {[...line].map((ch, ci) => {
                    const idx = offset + ci
                    return (
                      <span key={ci} className={idx < typed ? '' : 'text-transparent'}>
                        {ch}
                        {typing && idx === typed - 1 && <span className="relative"><span className="absolute top-[0.12em] left-[0.04em] h-[0.85em] w-[0.06em] animate-pulse bg-sun" /></span>}
                      </span>
                    )
                  })}
                </span>
              )
            })}
          </h2>
          <p className="max-w-[560px] text-lg leading-[1.45] text-cream sm:text-[22px]">
            400 unread messages, three spreadsheets, and nobody remembers who paid for the cabin. it’s time to pull it all into one space your whole crew can see.
          </p>
        </div>
    </section>
  )
}

/* ── features (82:2) ──────────────────────────────────────────── */

const CARD_SHADOW = 'shadow-[0_20px_44px_rgb(66_47_14/0.22)]'

function Tile({ tone, tag, title, body, children, className = '' }: { tone: string; tag: string; title: string; body: string; children: ReactNode; className?: string }) {
  return (
    <div className={`relative flex flex-col overflow-hidden rounded-[44px] p-8 sm:p-12 lg:h-[580px] ${tone} ${className}`}>
      <div className="flex flex-col items-start gap-[14px]">
        <span className="rounded-pill border-2 border-current px-4 py-1.5 text-base font-semibold">{tag}</span>
        <h3 className="text-[32px] font-bold sm:text-[42px] xl:whitespace-nowrap">{title}</h3>
        <p className="max-w-[400px] text-lg leading-[1.4] sm:text-xl">{body}</p>
      </div>
      {children}
    </div>
  )
}

/** mock widget slot: in-flow on phones, pinned bottom-right (clipped by the tile) on desktop */
const slot = (pos: string) => `relative mt-10 -mb-16 self-end lg:absolute lg:mt-0 lg:mb-0 ${pos}`

function WidgetHead({ icon, circle, label, ink }: { icon: IconName; circle: string; label: string; ink: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`flex size-10 items-center justify-center rounded-full ${circle} ${ink}`}><Icon name={icon} size={22} /></span>
      <span className="text-xl font-semibold">{label}</span>
    </div>
  )
}

function Bar({ pct, lead }: { pct: number; lead?: boolean }) {
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-[5px] bg-ink">
      <div className={`absolute inset-y-0 left-0 rounded-[5px] ${lead ? 'bg-sea' : 'bg-ink opacity-35'}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

const VOTE_OPTS = [
  { t: 'cliffside cabin', n: '4 votes', pct: 100, lead: true },
  { t: 'glamping tents', n: '2 votes', pct: 50 },
  { t: 'beach motel', n: '1 vote', pct: 25 },
]
const CREW = [
  { n: 'Maya', bg: 'bg-sunset text-cream', status: 'organizer', pill: 'bg-sunset text-cream' },
  { n: 'Jordan', bg: 'bg-sea', status: 'joined', pill: 'bg-sea' },
  { n: 'Priya', bg: 'bg-ink text-sun', status: 'joined', pill: 'bg-sea' },
  { n: 'Sam', bg: 'bg-sun border-[1.5px] border-ink', status: 'invited', pill: 'border-[1.5px] border-ink' },
]
const DAY_STOPS: { time: string; icon: IconName; circle: string; title: string; sub: string }[] = [
  { time: '8:30a', icon: 'camera', circle: 'bg-sunset text-cream', title: 'bixby bridge', sub: 'photo stop' },
  { time: '11:00a', icon: 'mountain', circle: 'bg-sea', title: 'mcway falls', sub: 'short hike' },
  { time: '4:00p', icon: 'sun', circle: 'bg-sunset text-cream', title: 'pfeiffer beach', sub: 'purple sand + keyhole rock' },
  { time: '7:30p', icon: 'food', circle: 'bg-sea', title: 'nepenthe', sub: 'sunset dinner' },
]
const BUDGET_ROWS = [['lodging', '$640'], ['gas', '$180'], ['food', '$320'], ['activities', '$100']]
const PACKING = [
  { t: 'sunscreen', done: true },
  { t: 'hiking boots', done: true },
  { t: 'national park pass' },
  { t: 'car snacks' },
  { t: 'aux cord + road trip playlist' },
]
const NOTE = 'don’t forget: grab a national park pass, and book nepenthe for a saturday sunset dinner 🌅'

function Features() {
  return (
    <section id="features" className="px-6 py-24 sm:px-12 lg:px-24 lg:pt-[120px] lg:pb-[144px]">
      <div className="mx-auto mb-[72px] flex max-w-[1320px] flex-col items-center gap-4 text-center">
        <h2 className="text-4xl font-bold leading-[1.05] sm:text-[64px]">everything your trip needs,<br />in one shared space.</h2>
        <p className="text-lg sm:text-[22px]">four simple tools. one place your whole crew can see.</p>
      </div>
      <div className="mx-auto grid max-w-[1320px] gap-4 lg:grid-cols-2">
        <Tile tone="bg-sunset text-cream" tag="invite" title="bring the whole crew" body="send one link and everyone’s in. no app download needed.">
          <div className={slot('lg:right-[41px] lg:top-[248px]')}>
            <div className={`flex w-[380px] max-w-full rotate-3 flex-col gap-[14px] rounded-card bg-cream p-[22px] text-ink ${CARD_SHADOW}`}>
              <span className="text-[22px] font-semibold">invite your crew</span>
              <div className="flex items-center gap-2.5">
                <span className="flex-1 rounded-pill border-2 border-ink bg-sun px-4 py-3 text-[15px]">friend@email.com</span>
                <span className="rounded-pill bg-sunset px-[18px] py-3 text-[15px] font-semibold text-cream">send</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">wander.app/t/pch-roadtrip</span>
                <span className="rounded-pill bg-sea px-3 py-[5px] text-[13px] font-medium">copy link</span>
              </div>
              <span className="text-[13px] font-medium">the crew</span>
              {CREW.map((c) => (
                <div key={c.n} className="flex items-center justify-between">
                  <span className="flex items-center gap-3 text-base font-semibold">
                    <span className={`flex size-[34px] items-center justify-center rounded-full text-[14.28px] ${c.bg}`}>{c.n[0]}</span>{c.n}
                  </span>
                  <span className={`rounded-pill px-3 py-[5px] text-[13px] font-medium ${c.pill}`}>{c.status}</span>
                </div>
              ))}
            </div>
          </div>
        </Tile>

        <Tile tone="bg-sea text-ink" tag="vote" title="decide without the debate" body="drop in options, let everyone vote, and watch the winner rise to the top.">
          <div className={slot('lg:right-[25px] lg:top-[316px]')}>
            <div className={`flex w-[360px] max-w-full -rotate-3 flex-col gap-4 rounded-[24px] bg-cream p-5 ${CARD_SHADOW}`}>
              <WidgetHead icon="vote" circle="bg-sea" ink="text-ink" label="vote" />
              <span className="text-[17px] font-semibold">where should we stay in big sur?</span>
              {VOTE_OPTS.map((o) => (
                <div key={o.t} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between"><span className="text-[15px] font-medium">{o.t}</span><span className="text-[13px]">{o.n}</span></div>
                  <Bar pct={o.pct} lead={o.lead} />
                </div>
              ))}
              <span className="text-[13px]">7 of 8 voted · closes friday</span>
            </div>
          </div>
        </Tile>

        <Tile tone="bg-ink text-sun" tag="plan" title="plan every day, stop by stop" body="turn the winning ideas into a day-by-day route everyone can follow.">
          <div className={slot('lg:right-[41px] lg:top-[274px]')}>
            <div className={`flex w-[400px] max-w-full rotate-3 flex-col rounded-card bg-cream p-6 text-ink ${CARD_SHADOW}`}>
              <div className="flex flex-col gap-1.5 pb-5">
                <div className="flex items-center gap-2.5">
                  <span className="rounded-pill bg-sea px-3 py-[5px] text-sm font-semibold">day 2</span>
                  <span className="text-[15px] font-medium">sun, jul 13</span>
                </div>
                <span className="text-2xl font-semibold">big sur</span>
              </div>
              {DAY_STOPS.map((s, i) => (
                <div key={s.title}>
                  {i > 0 && <div className="flex gap-3"><span className="w-16" /><img src={connectorUrl} alt="" width={44} height={20} /></div>}
                  <div className="flex items-center gap-3">
                    <span className="flex h-[26px] w-16 shrink-0 items-center justify-center rounded-pill bg-ink text-[13px] font-medium text-sun">{s.time}</span>
                    <span className={`flex size-11 shrink-0 items-center justify-center rounded-full ${s.circle}`}><Icon name={s.icon} size={22} /></span>
                    <span className="flex min-w-0 flex-col gap-px">
                      <span className="text-[17px] font-semibold">{s.title}</span>
                      <span className="text-[13px]">{s.sub}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Tile>

        <Tile tone="border-2 border-ink bg-cream text-ink" tag="budget" title="split it, fairly" body="log an expense once and we’ll do the math on who owes who.">
          <div className={slot('lg:right-[24px] lg:top-[270px]')}>
            <div className={`flex w-[360px] max-w-full -rotate-3 flex-col gap-4 rounded-[24px] bg-cream p-5 ${CARD_SHADOW}`}>
              <WidgetHead icon="budget" circle="bg-sea" ink="text-ink" label="budget" />
              <div className="flex items-baseline gap-2"><span className="text-[40px] font-bold">$1,240</span><span className="text-base">of $1,600</span></div>
              <Bar pct={77.5} lead />
              {BUDGET_ROWS.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-[15px]"><span>{k}</span><span className="font-semibold">{v}</span></div>
              ))}
              <span className="self-start rounded-pill bg-sun px-3 py-[5px] text-sm font-medium">≈ $310 per person</span>
            </div>
          </div>
        </Tile>

        <div className="relative flex flex-col overflow-hidden rounded-[44px] border-2 border-ink bg-cream p-8 sm:p-12 lg:col-span-2 lg:h-[420px] lg:justify-center">
          <div className="flex flex-col items-start gap-[14px]">
            <span className="rounded-pill border-2 border-ink px-4 py-1.5 text-base font-semibold">notes · checklists · notifications</span>
            <h3 className="text-[32px] font-bold sm:text-[42px]">the little things, too</h3>
            <p className="max-w-[440px] text-lg leading-[1.4] sm:text-xl">packing lists, shared notes, and a heads-up whenever plans change, so nothing slips through the cracks.</p>
          </div>
          <div className="mt-10 flex flex-wrap gap-6 lg:mt-0">
            <div className={`flex w-[360px] max-w-full rotate-2 flex-col gap-[14px] rounded-[24px] bg-cream p-5 lg:absolute lg:right-[342px] lg:top-[38px] ${CARD_SHADOW}`}>
              <WidgetHead icon="checklist" circle="bg-sunset" ink="text-cream" label="packing list" />
              {PACKING.map((p) => (
                <div key={p.t} className="flex items-center gap-3">
                  {p.done
                    ? <span className="flex size-6 items-center justify-center rounded-lg bg-sea text-cream"><Icon name="check" size={16} /></span>
                    : <span className="size-6 rounded-lg border-2 border-ink" />}
                  <span className={`text-base ${p.done ? 'line-through' : ''}`}>{p.t}</span>
                </div>
              ))}
              <span className="text-[13px]">2 of 5 packed</span>
            </div>
            <div className={`flex w-[360px] max-w-full -rotate-3 flex-col gap-[14px] rounded-[24px] bg-cream p-5 lg:absolute lg:-right-[47px] lg:top-[59px] ${CARD_SHADOW}`}>
              <WidgetHead icon="note" circle="bg-ink" ink="text-sun" label="note" />
              <p className="text-[17px]">{NOTE}</p>
              <span className="text-sm font-medium">— Priya</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ── vibes (82:227) ───────────────────────────────────────────── */

type VibeStyle = 'sunset' | 'sea' | 'sun' | 'cream' | 'outline'
const VIBE_STYLE: Record<VibeStyle, string> = {
  sunset: 'bg-sunset text-cream font-semibold',
  sea: 'bg-sea text-ink font-semibold',
  sun: 'bg-sun text-ink font-semibold',
  cream: 'bg-cream text-ink font-semibold',
  outline: 'border-[2.5px] border-cream text-cream font-medium',
}
const VIBE_ROWS: [string, VibeStyle][][] = [
  [['tropical', 'sunset'], ['road trips', 'outline'], ['busy city', 'sea'], ['countryside', 'outline']],
  [['outdoorsy', 'outline'], ['foodie', 'sun'], ['beach days', 'outline'], ['nightlife', 'sunset'], ['hidden gems', 'outline']],
  [['art & museums', 'sea'], ['slow & cozy', 'outline'], ['mountains', 'cream'], ['budget-friendly', 'outline']],
  [['girls’ trip', 'outline'], ['spring break', 'sunset'], ['family reunion', 'outline'], ['bachelorette', 'sea']],
]

function Vibes() {
  return (
    <section className="bg-ink px-6 py-24 sm:px-12 lg:pt-[110px] lg:pb-[120px]">
      <div className="mb-16 flex flex-col items-center gap-4 text-center">
        <h2 className="text-4xl font-bold text-sun sm:text-[64px]">whatever your vibe</h2>
        <p className="text-lg text-cream sm:text-[22px]">tell us what your crew is into and get ideas that actually fit.</p>
      </div>
      <div className="mx-auto flex max-w-[1117px] flex-col items-center gap-4">
        {VIBE_ROWS.map((row, i) => (
          <div key={i} className="flex flex-wrap justify-center gap-[14px]">
            {row.map(([label, style]) => (
              <span key={label} className={`rounded-pill px-5 pt-2 pb-2.5 text-xl whitespace-nowrap sm:px-[30px] sm:pt-[14px] sm:pb-4 sm:text-[34px] ${VIBE_STYLE[style]}`}>{label}</span>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── app preview (83:2) — a still of the live Trip Space (demo trip), drawn at app scale ─── */

const PREVIEW_W = 1440
const CANVAS_H = 800
const PREVIEW_H = 40 + 80 + CANVAS_H
const PREVIEW_CREW: { n: string; tone: Tone }[] = [
  { n: 'Maya', tone: 'sunset' }, { n: 'Jordan', tone: 'sea' }, { n: 'Priya', tone: 'ink' }, { n: 'Sam', tone: 'sun' },
]
const PREVIEW_TABS: { label: string; icon: IconName; on?: boolean }[] = [
  { label: 'trip space', icon: 'tabGrid', on: true }, { label: 'itinerary', icon: 'tabPlan' }, { label: 'expenses', icon: 'dollar' },
]
const PREVIEW_TOOLS: { label: string; icon: IconName }[] = [
  { label: 'vote', icon: 'vote' }, { label: 'budget', icon: 'budget' }, { label: 'note', icon: 'note' },
  { label: 'list', icon: 'checklist' }, { label: 'map', icon: 'map' },
]

/** same chrome as TripSpace's DraggableWidget */
function MockWidget({ x, y, sun, children }: { x: number; y: number; sun?: boolean; children: ReactNode }) {
  return (
    <section className={`absolute w-[360px] rounded-card p-4 shadow-card ${sun ? 'bg-sun' : 'bg-cream'}`} style={{ left: x, top: y }}>
      <div className="mb-2 flex items-center"><span className="-ml-1 px-1 text-ink/35">⋮⋮</span></div>
      {children}
    </section>
  )
}

function MockAdd({ placeholder }: { placeholder: string }) {
  return (
    <div className="flex gap-2">
      <span className="flex h-9 flex-1 items-center rounded-pill bg-white/70 px-4 text-sm text-ink/40">{placeholder}</span>
      <Button small variant="cream" tabIndex={-1} aria-hidden><Icon name="plus" size={14} /></Button>
    </div>
  )
}

function AppPreview() {
  return (
    <section id="how-it-works" className="bg-sunset px-6 py-24 sm:px-12 lg:pt-[110px] lg:pb-[120px]">
      <div className="mb-16 flex flex-col items-center gap-4 text-center text-cream">
        <h2 className="text-4xl font-bold sm:text-[64px]">your whole trip, one space</h2>
        <p className="text-lg sm:text-[22px]">a shared whiteboard for your crew, from the first idea to the last receipt.</p>
      </div>
      <FitWidth width={PREVIEW_W} height={PREVIEW_H} className="pointer-events-none mx-auto w-full max-w-[1440px] select-none">
        <div aria-hidden className="absolute inset-0 overflow-hidden rounded-card bg-cream text-ink shadow-[0_28px_60px_rgb(66_47_14/0.3)]">
          <div className="flex h-10 items-center gap-2 pl-5">
            <span className="size-3 rounded-full bg-sunset" /><span className="size-3 rounded-full bg-sea" /><span className="size-3 rounded-full bg-ink" />
          </div>

          {/* TripLayout header */}
          <header className="relative z-10 flex h-topbar items-center gap-5 bg-cream px-6 shadow-card">
            <span className="p-2"><Icon name="back" size={22} /></span>
            <Pin size={40} />
            <span className="px-2 text-xl font-semibold lowercase">pacific coast road trip</span>
            <nav className="mx-auto flex gap-1 rounded-pill bg-sun p-1">
              {PREVIEW_TABS.map((t) => (
                <span key={t.label} className={`inline-flex h-10 items-center gap-2 rounded-pill px-4 text-sm font-semibold lowercase ${t.on ? 'bg-sea text-cream' : 'text-ink/70'}`}>
                  <Icon name={t.icon} size={18} />{t.label}
                </span>
              ))}
            </nav>
            <div className="flex items-center gap-3">
              <span className="h-2.5 w-2.5 rounded-full bg-sea" />
              <div className="flex -space-x-2">{PREVIEW_CREW.map((c) => <Avatar key={c.n} name={c.n} tone={c.tone} size={32} ring />)}</div>
              <Button small variant="sea" tabIndex={-1}><Icon name="invite" size={16} />invite</Button>
              <span className="relative p-2"><Icon name="bell" size={22} /><span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-sunset" /></span>
            </div>
          </header>

          {/* TripSpace canvas with the demo trip's widgets at their seeded positions */}
          <div className="bg-dot-grid relative bg-sun" style={{ height: CANVAS_H }}>
            <MockWidget x={176} y={48}>
              <div className="space-y-3">
                <p className="text-lg leading-snug font-semibold lowercase">where should we stay in big sur?</p>
                <ul className="space-y-2">
                  {VOTE_OPTS.map((o) => (
                    <li key={o.t} className="relative flex h-12 items-center justify-between overflow-hidden rounded-pill border-2 border-transparent bg-white/70 px-4 text-sm font-semibold lowercase">
                      <span className="absolute inset-y-0 left-0 bg-sea/25" style={{ width: `${o.pct}%` }} />
                      <span className="relative">{o.t}</span>
                      <span className="relative tabular-nums">{parseInt(o.n)}</span>
                    </li>
                  ))}
                </ul>
                <MockAdd placeholder="add an option" />
                <p className="text-xs text-ink/55">7 of 8 voted · closes friday</p>
              </div>
            </MockWidget>

            <MockWidget x={572} y={48}>
              <div className="space-y-3">
                <div>
                  <div className="text-3xl font-semibold tabular-nums">$1,240</div>
                  <div className="text-sm text-ink/60">of $1,600 budget</div>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-white/70"><div className="h-full w-[77.5%] rounded-full bg-sunset" /></div>
                <div className="flex justify-between text-sm"><span className="text-ink/60">about each</span><b className="tabular-nums">$310</b></div>
                <div className="flex gap-2">
                  <Button small variant="sea" className="flex-1" tabIndex={-1}>see full budget</Button>
                  <Button small variant="cream" tabIndex={-1}>find deals</Button>
                </div>
              </div>
            </MockWidget>

            <MockWidget x={968} y={48} sun>
              <p className="min-h-[140px] text-base leading-relaxed">{NOTE}</p>
              <p className="mt-1 text-xs text-ink/55">— Priya</p>
            </MockWidget>

            <MockWidget x={176} y={468}>
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-semibold lowercase">packing list</span>
                  <span className="text-xs text-ink/55">2/5</span>
                </div>
                <ul className="space-y-1.5">
                  {PACKING.map((p) => (
                    <li key={p.t} className="flex items-center gap-3 text-sm">
                      {p.done
                        ? <span className="flex h-5 w-5 items-center justify-center rounded bg-sea text-cream"><Icon name="check" size={14} /></span>
                        : <span className="h-5 w-5 rounded border border-ink/50 bg-white" />}
                      <span className={p.done ? 'text-ink/40 line-through' : ''}>{p.t}</span>
                    </li>
                  ))}
                </ul>
                <MockAdd placeholder="add item" />
              </div>
            </MockWidget>

            {/* bottom add bar */}
            <div className="absolute inset-x-0 bottom-4 flex justify-center">
              <div className="flex items-center gap-1 rounded-pill bg-cream p-1.5 shadow-float">
                {PREVIEW_TOOLS.map((t) => (
                  <span key={t.label} className="inline-flex h-11 items-center gap-1.5 rounded-pill px-4 text-sm font-semibold lowercase text-ink/80">
                    <Icon name={t.icon} size={20} />{t.label}
                  </span>
                ))}
              </div>
            </div>

            {/* "plan it for me" mascot */}
            <div className="absolute right-6 bottom-6 flex flex-col items-end gap-1">
              <span className="relative rounded-pill bg-cream px-4 py-2 text-sm font-semibold lowercase shadow-float">
                plan it for me
                <span className="absolute right-6 -bottom-1.5 h-3 w-3 rotate-45 bg-cream [clip-path:polygon(100%_0,100%_100%,0_100%)]" />
              </span>
              <Pin size={72} className="mr-2 drop-shadow-md" />
            </div>
          </div>
        </div>
      </FitWidth>
    </section>
  )
}

/* ── cta (83:231) ─────────────────────────────────────────────── */

function Cta({ onGuest }: { onGuest: () => void }) {
  return (
    <section className="relative flex flex-col items-center gap-7 px-6 py-24 text-center sm:px-12 lg:min-h-[640px] lg:justify-center lg:py-0">
      <h2 className="flex flex-wrap items-baseline justify-center gap-x-[0.11em] text-[56px] font-bold sm:text-[80px] lg:text-[104px]">
        ready to
        <span className="flex items-baseline">
          <Wordmark height={0} className="mr-[0.02em] !h-auto w-[3.42em]" />?
        </span>
      </h2>
      <p className="text-lg sm:text-2xl">start your first trip in under a minute. free for you and your whole crew.</p>
      <div className="flex flex-wrap justify-center gap-[14px]">
        <Link to="/start" state={{ showAuth: true }} className={`${PILL_BTN} bg-sunset px-[30px] py-[18px] text-cream hover:brightness-105`}>start a trip</Link>
        <button type="button" onClick={onGuest} className={`${PILL_BTN} border-2 border-ink px-[30px] py-[18px] hover:bg-ink/5`}>continue as guest</button>
      </div>
      <Sprite size={200} className="absolute right-16 bottom-12 hidden lg:block" />
    </section>
  )
}

/* ── footer (83:244) ──────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="bg-sea px-6 py-16 sm:px-12 lg:h-[240px] lg:px-24">
      <div className="mx-auto flex max-w-[1320px] flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-4">
          <Logo height={52} className="self-start" />
          <p className="text-lg">made for friends who travel together.</p>
        </div>
        <div className="flex flex-col gap-4 lg:items-end lg:pt-[14px]">
          <nav className="flex flex-wrap gap-x-9 gap-y-2 text-[17px] font-medium">
            <a href="#how-it-works" className="hover:underline">how it works</a>
            <a href="#features" className="hover:underline">features</a>
            <Link to="/start" className="hover:underline">sign in</Link>
            <span>terms</span>
            <span>privacy</span>
          </nav>
          <p className="text-[15px]">© 2026 · all rights reserved</p>
        </div>
      </div>
    </footer>
  )
}
