import * as Popover from '@radix-ui/react-popover'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { TripProvider, useConnection, usePeers, useTrip, useYArray, useYMap } from '../../collab/TripProvider'
import type { TripType } from '../../collab/types'
import { saveTrip } from '../../lib/trips'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { Icon, } from '../ui/Icon'
import type { IconName } from '../../icons/figmaIcons'

export function TripLayout() {
  const { tripId = '' } = useParams()
  return (
    <TripProvider tripId={tripId}>
      <Shell tripId={tripId} />
    </TripProvider>
  )
}

const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '', label: 'trip space', icon: 'tabGrid', end: true },
  { to: 'plan', label: 'plan', icon: 'tabPlan' },
  { to: 'budget', label: 'budget', icon: 'dollar' },
]

function Shell({ tripId }: { tripId: string }) {
  const { room } = useTrip()
  const meta = useYMap(room.meta)
  const name = (meta.name as string) || tripId.replace(/-/g, ' ')

  // Remember trips this browser has opened (so invitees see them in "my trips").
  useEffect(() => {
    if (meta.name) saveTrip({ id: tripId, name: meta.name as string, type: (meta.type as TripType) ?? 'day trip', place: (meta.place as string) ?? '', start: (meta.start as string) ?? '', end: (meta.end as string) ?? '' })
  }, [tripId, meta.name, meta.type, meta.place, meta.start, meta.end])

  return (
    <div className="flex h-dvh flex-col">
      <header className="z-30 flex h-topbar shrink-0 items-center gap-3 bg-cream px-3 shadow-card sm:gap-5 sm:px-6">
        <Link to="/trips" aria-label="back to my trips" className="rounded-full p-2 hover:bg-ink/10"><Icon name="back" size={22} /></Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold lowercase sm:flex-none sm:text-xl">{name}</h1>
        <nav className="mx-auto hidden gap-1 rounded-pill bg-sun p-1 sm:flex">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end}
              className={({ isActive }) => `inline-flex h-10 items-center gap-2 rounded-pill px-4 text-sm font-semibold lowercase transition ${isActive ? 'bg-sea text-cream' : 'text-ink/70 hover:text-ink'}`}>
              <Icon name={t.icon} size={18} />{t.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <ConnectionDot />
          <PresenceStack />
          <InvitePopover tripId={tripId} />
          <NotificationsPopover />
        </div>
      </header>
      <main className="relative min-h-0 flex-1"><Outlet /></main>
      <nav className="z-30 flex shrink-0 justify-around bg-cream py-1 shadow-[0_-4px_12px_rgb(66_47_14/0.08)] sm:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-semibold lowercase ${isActive ? 'text-sunset' : 'text-ink/55'}`}>
            <Icon name={t.icon} size={22} />{t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

function ConnectionDot() {
  const status = useConnection()
  const color = status === 'connected' ? 'bg-sea' : status === 'connecting' ? 'bg-sun' : 'bg-sunset'
  const label = status === 'connected' ? 'live' : status === 'connecting' ? 'connecting…' : 'offline — syncing across tabs only'
  return <span title={label} aria-label={label} className={`hidden h-2.5 w-2.5 rounded-full sm:block ${color}`} />
}

function PresenceStack() {
  const peers = usePeers()
  const shown = peers.slice(0, 4)
  return (
    <div className="flex -space-x-2" aria-label={`${peers.length} here now`}>
      {shown.map((p) => <Avatar key={p.clientId} name={p.isMe ? `${p.user.name} (you)` : p.user.name} tone={p.user.tone} size={32} ring />)}
      {peers.length > shown.length && <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink text-xs font-semibold text-cream ring-2 ring-cream">+{peers.length - shown.length}</span>}
    </div>
  )
}

function InvitePopover({ tripId }: { tripId: string }) {
  const [copied, setCopied] = useState(false)
  const link = `${location.origin}/t/${tripId}`
  const copy = async () => {
    try { await navigator.clipboard.writeText(link) } catch { /* clipboard blocked — link is selectable */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button small variant="sea" aria-label="invite"><Icon name="invite" size={16} /><span className="hidden sm:inline">invite</span></Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="animate-pop z-50 w-[min(340px,92vw)] rounded-card bg-cream p-4 shadow-float">
          <p className="mb-2 text-sm font-semibold lowercase">share this link — anyone with it joins the trip</p>
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="mb-3 h-10 w-full rounded-pill bg-white px-4 text-sm" />
          <Button small className="w-full" onClick={copy}>{copied ? 'copied!' : 'copy link'}</Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function NotificationsPopover() {
  const { room } = useTrip()
  const feed = useYArray(room.feed)
  const members = useYMap(room.members)
  const items = [...feed].sort((a, b) => b.ts - a.ts).slice(0, 30)
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button aria-label="notifications" className="relative rounded-full p-2 hover:bg-ink/10">
          <Icon name="bell" size={22} />
          {feed.length > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-sunset" />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="animate-pop z-50 max-h-[70dvh] w-[min(380px,94vw)] overflow-y-auto rounded-card bg-cream p-3 shadow-float">
          <p className="px-2 pb-2 text-sm font-semibold lowercase">activity</p>
          {items.length === 0 && <p className="px-2 py-6 text-center text-sm text-ink/50">nothing yet</p>}
          <ul className="space-y-1">
            {items.map((f) => (
              <li key={f.id} className="flex items-start gap-3 rounded-2xl px-2 py-2 hover:bg-white/70">
                <Avatar name={f.by} tone={members[f.byId]?.tone ?? 'sea'} size={28} />
                <div className="min-w-0 text-sm"><b className="font-semibold">{f.by}</b> {f.text}
                  <div className="text-xs text-ink/45">{ago(f.ts)}</div></div>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function ago(ts: number) {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
