import { useEffect, useState } from 'react'
import {
  TripHeader,
  WorkspaceTabs,
  TripName,
  InvitePopover,
  ActivityPopover,
} from '../../components/trip/TripLayout'
import { Pin } from '../../components/brand/Pin'
import { TripSpaceSurface } from '../space/TripSpace'
import { NativePollStatus, PlaceMap, NoteField, VoteOption, CheckItem, PollDeadline } from '../space/Widgets'
import type { WidgetType } from '../../collab/types'
import { LocationMap } from '../space/LocationMap'
import { Button } from '../../components/ui/Button'
import { LockKeyhole, Check } from 'lucide-react'
import { Icon } from '../../components/ui/Icon'
import { Avatar } from '../../components/ui/Avatar'
import { PlanView } from '../plan/Plan'
import { BudgetView } from '../budget/Budget'
import { PilotBudgetView, type BudgetCardData } from '../space/PilotBudgetBody'
import { amountText } from '../../collab/pilot-budget.mjs'
import { PlanningPanel } from '../ai/PromptToTrip'
import type { Expense } from '../../lib/settle'
import type { Day, Stop, FeedItem, Member as TripMember } from '../../collab/types'
import './claim.css'

interface Member {
  id: string
  masked: string
  claimed: boolean
  name?: string
}
interface Invite {
  title: string
  verified: boolean
  name?: string
  members: Member[]
}
interface Card {
  id: string
  type: WidgetType
  z: number
  title: string
  text?: string
  url?: string
  by?: string
  status?: string
  nativePoll?: { state: string; unsupported: boolean }
  voteSummary?: string
  due?: string
  waiting?: string[]
  usesPhoton?: boolean
  options?: { id: string; text: string; voters: string[]; mine: boolean }[]
  items?: { id: string; text: string; done: boolean }[]
  places?: { id: string; by: string; label: string; url?: string; point?: number[] }[]
  x: number
  y: number
  w?: number
  h?: number
}
interface Board {
  title: string
  cards: Card[]
  invite?: string
  online?: string[]
  viewerId: string
  days: Day[]
  stops: Stop[]
  expenses: Expense[]
  budget: BudgetCardData
  members: Record<string, TripMember>
  paid: Record<string, boolean>
  activity: FeedItem[]
  viewerName?: string
}

const trip = location.pathname.split('/')[2]
async function api(action: string, payload?: unknown) {
  const response = await fetch('/api/trip/' + trip + '/' + action, {
    method: payload === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-wander-invite': location.hash.slice(1) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const result = await response.json()
  if (!response.ok)
    throw Object.assign(new Error(result.error || 'Please try again.'), { status: response.status })
  return result
}
export function HostedTrip() {
  if (location.pathname.startsWith('/t/')) return <Canvas />
  if (!trip) return <Welcome />
  return <Claim />
}
function Welcome() {
  const [mode, setMode] = useState<'create' | 'join'>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <main className="claim-shell claim-home">
      <section className="claim-panel">
        <h1>Wander</h1>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={() => {
              setError('')
              setMode('create')
            }}
          >
            Start a canvas
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setError('')
              setMode('join')
            }}
          >
            Join via group invite
          </Button>
        </div>
        {mode && (
          <form
            key={mode}
            className="grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault()
              const fields = new FormData(event.currentTarget)
              setError('')
              if (mode === 'join') {
                const url = URL.canParse(String(fields.get('invite')))
                  ? new URL(String(fields.get('invite')))
                  : null
                if (
                  url?.origin === location.origin &&
                  /^\/join\/[0-9a-f-]{36}\/?$/i.test(url.pathname) &&
                  url.hash.length > 1
                ) {
                  location.assign(url.pathname + url.hash)
                } else setError('Paste the Wander invite link from your group chat.')
                return
              }
              setBusy(true)
              try {
                const response = await fetch('/api/manual-trip', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ title: fields.get('title'), name: fields.get('name') }),
                })
                const result = await response.json()
                if (!response.ok) throw new Error(result.error)
                location.assign(result.path)
              } catch (e) {
                setError((e as Error).message || 'Could not start the canvas. Try again.')
                setBusy(false)
              }
            }}
          >
            {mode === 'create' ? (
              <>
                <label>
                  Trip name
                  <input className="claim-name" name="title" required maxLength={60} />
                </label>
                <label>
                  Your name
                  <input className="claim-name" name="name" required maxLength={60} />
                </label>
              </>
            ) : (
              <label>
                Invite link
                <input className="claim-name" name="invite" type="url" required />
              </label>
            )}
            <Button type="submit" disabled={busy}>
              {mode === 'create' ? 'Create canvas' : 'Open invite'}
            </Button>
          </form>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    </main>
  )
}
function Claim() {
  const [info, setInfo] = useState<Invite>(),
    [stage, step] = useState<'pick' | 'code' | 'name'>('pick')
  const [selected, select] = useState(''),
    [code, setCode] = useState(''),
    [challenge, setChallenge] = useState('')
  const [name, setName] = useState(''),
    [busy, loading] = useState(false),
    [error, fail] = useState(''),
    [wait, count] = useState(0)
  const member = info?.members.find((m) => m.id === selected)
  const enter = () => location.replace('/t/' + trip)
  useEffect(() => {
    let mounted = true
    api('invite')
      .then((i: Invite) => {
        if (!mounted) return
        setInfo(i)
        if (i.verified) {
          if (i.name) enter()
          else step('name')
        }
      })
      .catch((e) => fail(e.message))
    return () => {
      mounted = false
    }
  }, [])
  useEffect(() => {
    if (wait) {
      const t = setTimeout(() => count(wait - 1), 1000)
      return () => clearTimeout(t)
    }
  }, [wait])
  async function run(fn: () => Promise<void>) {
    loading(true)
    fail('')
    try {
      await fn()
    } catch (e) {
      fail((e as Error).message)
    } finally {
      loading(false)
    }
  }
  async function send() {
    const r = await api('challenge', { picker: selected })
    setChallenge(r.challenge)
    setCode('')
    count(60)
    step('code')
  }
  function back() {
    step('pick')
    setCode('')
    fail('')
  }
  return (
    <main className="claim-shell bg-dot-grid">
      <header aria-hidden="true">
        {info?.title || 'Wander'} <span>trip space</span>
      </header>
      <div aria-hidden="true" className="claim-ghost">
        <i />
        <i />
        <i />
      </div>
      <div className="claim-overlay">
        <form
          className="claim-panel"
          aria-busy={busy}
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              if (stage === 'pick') await send()
              if (stage === 'code') {
                const r = await api('verify', { challenge, code })
                if (r.name) enter()
                else step('name')
              }
              if (stage === 'name') {
                await api('name', { name })
                location.replace('/t/' + trip + '#welcome')
              }
            })
          }}
        >
          {stage === 'name' && (
            <strong className="claim-verified">
              <Check size={16} /> {member?.masked} verified
            </strong>
          )}
          <p>{info?.title || 'Wander'} · invited from your group chat</p>
          <h1>
            {stage === 'pick'
              ? 'Which number is yours?'
              : stage === 'code'
                ? error.includes('doesn’t match')
                  ? 'Hmm, that’s not it'
                  : 'We sent you a message'
                : 'You’re in! What’s your name?'}
          </h1>
          {stage === 'pick' && (
            <>
              <p>
                Pick your number from the group chat and we’ll text you a code to make sure it’s really you.
              </p>
              <fieldset disabled={busy}>
                <legend>Numbers in the group chat</legend>
                {!info && !error && <p>Loading numbers…</p>}
                {info && !info.members.length && <p>No eligible phone numbers in this group.</p>}
                {info?.members.map((m) => (
                  <label className="claim-row" data-claimed={m.claimed} key={m.id}>
                    <input
                      type="radio"
                      name="number"
                      checked={selected === m.id}
                      onChange={() => select(m.id)}
                    />
                    <span className="claim-avatar">
                      {selected === m.id ? <Check size={16} /> : m.name?.slice(0, 1)}
                    </span>
                    <span>
                      <b>{m.masked}</b>
                      <small>
                        {m.claimed
                          ? m.name
                            ? 'Claimed by ' + m.name
                            : 'Verify again on this device'
                          : 'Unclaimed · is this you?'}
                      </small>
                    </span>
                    <strong>
                      {m.claimed && <LockKeyhole size={12} />} {m.claimed ? 'claimed' : 'unclaimed'}
                    </strong>
                  </label>
                ))}
              </fieldset>
            </>
          )}
          {stage === 'code' && (
            <>
              <p>Enter the six-digit code we sent privately to {member?.masked}.</p>
              <label className="claim-digits">
                <span aria-hidden="true">
                  {Array.from({ length: 6 }, (_, i) => (
                    <b key={i} data-active={i === code.length}>
                      {code[i] || (i === code.length ? '' : '·')}
                    </b>
                  ))}
                </span>
                <input
                  aria-label="Verification code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
              </label>
              <div className="claim-links">
                <button type="button" disabled={busy || wait > 0} onClick={() => void run(send)}>
                  {wait ? 'Resend in ' + wait + 's' : 'Send a new code'}
                </button>
                <button type="button" disabled={busy} onClick={back}>
                  Pick a different number
                </button>
              </div>
            </>
          )}
          {stage === 'name' && (
            <>
              <p>This is the name your crew will see on the trip board.</p>
              <label>
                Your name
                <input
                  className="claim-name"
                  autoFocus
                  autoComplete="given-name"
                  maxLength={60}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <footer>
            {stage === 'code' && (
              <Button variant="ghost" type="button" disabled={busy} onClick={back}>
                Back
              </Button>
            )}
            {stage === 'pick' && <small>Numbers are partly hidden so only your crew recognizes them.</small>}
            <Button
              type="submit"
              disabled={
                busy ||
                (stage === 'pick' && !member) ||
                (stage === 'code' && code.length !== 6) ||
                (stage === 'name' && !name.trim())
              }
            >
              {busy
                ? 'One moment…'
                : stage === 'pick'
                  ? 'Text me a code'
                  : stage === 'code'
                    ? error.includes('doesn’t match')
                      ? 'Try again'
                      : 'Verify'
                    : 'Enter the trip'}
            </Button>
          </footer>
        </form>
      </div>
    </main>
  )
}
function Canvas() {
  const [tab, setTab] = useState(location.hash.slice(1))
  const [planning, setPlanning] = useState(false)
  useEffect(() => {
    const changed = () => setTab(location.hash.slice(1))
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  const [welcome, setWelcome] = useState('')
  const [board, setBoard] = useState<Board>(),
    [invite, setInvite] = useState(''),
    [status, setStatus] = useState('Connecting…'),
    [error, fail] = useState('')
  useEffect(() => {
    let ws: WebSocket | undefined,
      closed = false,
      timer: ReturnType<typeof setTimeout>
    async function connect() {
      try {
        const initial: Board = await api('canvas')
        if (closed) return
        fail('')
        setBoard(initial)
        if (location.hash === '#welcome') {
          history.replaceState(null, '', location.pathname)
          setWelcome('Welcome to the trip, ' + initial.viewerName + '!')
        }
        setInvite(initial.invite || '')
        ws = new WebSocket(
          (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/live/' + trip,
        )
        ws.onmessage = (e) => {
          setBoard(JSON.parse(e.data))
          setStatus('Live')
        }
        ws.onclose = () => {
          if (!closed) {
            setStatus('Reconnecting…')
            timer = setTimeout(connect, 1500)
          }
        }
      } catch (e) {
        if (!closed) {
          setBoard(undefined)
          fail((e as Error).message)
          if (![401, 403, 404].includes((e as { status: number }).status)) timer = setTimeout(connect, 1500)
        }
      }
    }
    void connect()
    return () => {
      closed = true
      clearTimeout(timer)
      ws?.close()
    }
  }, [])
  const mutate = (values: Record<string, unknown>) => api('edit', values).catch((e) => fail(e.message))
  const edit = (card: string, item: string, selected: boolean) =>
    api('edit', { card, item, selected }).catch((e) => fail(e.message))
  return (
    <main className="flex h-dvh flex-col bg-sun">
      <TripHeader>
        <a href="/" aria-label="back to Wander" className="rounded-full p-2 hover:bg-ink/10">
          <Icon name="back" size={22} />
        </a>
        <a href="/" aria-label="wander home" className="hidden shrink-0 sm:block">
          <Pin size={40} />
        </a>
        <TripName
          name={board?.title || 'Trip canvas'}
          onRename={(value) => void mutate({ action: 'rename-trip', value })}
        />
        <WorkspaceTabs tab={tab} />
        <div className="ml-auto flex items-center gap-1 sm:gap-3">
          <span
            role="status"
            title={status}
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${status === 'Live' ? 'bg-sea' : 'bg-sunset'}`}
          >
            <span className="sr-only">{status}</span>
          </span>
          <div className="flex -space-x-2" aria-label={(board?.online?.length ?? 0) + ' here now'}>
            {(board?.online ?? [])
              .slice(0, 4)
              .map((id) => board!.members[id])
              .filter(Boolean)
              .map((m) => (
                <Avatar
                  key={m.id}
                  name={m.name + (m.id === board?.viewerId ? ' (you)' : '')}
                  tone={m.id === board?.viewerId ? 'sun' : m.tone}
                  size={32}
                  ring
                />
              ))}
          </div>
          {invite && <InvitePopover tripId={trip} invitation={invite} />}
          {board && <ActivityPopover feed={board.activity} members={board.members} />}
          <button
            onClick={async () => {
              await api('logout', {})
              location.replace(invite || '/')
            }}
          >
            <span className="text-xs">Log out</span>
          </button>
        </div>
      </TripHeader>
      {welcome && (
        <button className="claim-welcome" onClick={() => setWelcome('')}>
          {welcome} ×
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="relative min-h-0 flex-1">
        {board &&
          (tab === 'plan' ? (
            <PlanView
              days={board.days}
              stops={board.stops}
              actions={{
                addDay: () => void mutate({ action: 'add-day' }),
                addStop: (day, stop) => void mutate({ action: 'add-stop', day, ...stop }),
                removeStop: (id) => void mutate({ action: 'remove-stop', id }),
                moveStop: (id, day, index) => void mutate({ action: 'move-stop', id, day, index }),
              }}
            />
          ) : tab === 'budget' ? (
            <BudgetView
              {...board}
              meId={board.viewerId}
              tripCurrency={board.budget.preferred}
              activeIds={board.budget.rows.map((row) => row.id)}
              actions={{
                addExpense: (expense) => api('edit', { action: 'add-expense', ...expense }),
                editExpense: (id, expense) => api('edit', { action: 'edit-expense', id, ...expense }),
                removeExpense: (id) => void mutate({ action: 'remove-expense', id }),
                togglePaid: (key) => void mutate({ action: 'settle', key, selected: !board.paid[key] }),
              }}
            />
          ) : (
            <TripSpaceSurface
              onAi={() => setPlanning(true)}
              extra={
                <PlanningPanel
                  open={planning}
                  onOpenChange={setPlanning}
                  append
                  generate={() => mutate({ action: 'sample-plan' })}
                />
              }
              widgets={board.cards}
              actions={{
                addWidget: (type) => void mutate({ action: 'create', type }),
                removeWidget: (card) => void mutate({ action: 'delete', card }),
                moveWidget: (card, x, y) => void mutate({ action: 'move', card, x, y }),
                resizeWidget: (card, width, height) => void mutate({ action: 'resize', card, width, height }),
              }}
              renderBody={(w) => (
                <div className={w.type === 'map' ? 'flex min-h-0 flex-1 flex-col' : 'min-h-0 space-y-3'}>
                  {['vote', 'checklist'].includes(w.type) ? (
                    <div className="flex items-baseline justify-between">
                      <Inline
                        label={w.type === 'vote' ? 'Vote question' : 'List title'}
                        value={w.title}
                        save={(value, previous) => mutate({ action: 'field', card: w.id, value, previous })}
                      />
                      {w.items && (
                        <span className="text-xs text-ink/55">
                          {w.items.filter((i) => i.done).length}/{w.items.length}
                        </span>
                      )}
                    </div>
                  ) : (
                    w.places && <h2 className="text-lg font-semibold">{w.title}</h2>
                  )}
                  {w.type === 'map' && !w.places && (
                    <PlaceMap
                      place={w.text ?? ''}
                      save={(value) =>
                        void mutate({ action: 'field', card: w.id, value, previous: w.text ?? '' })
                      }
                    />
                  )}

                  {w.status && (
                    <p role="status" className="text-xs text-ink/55">
                      {w.status}
                    </p>
                  )}
                  {(w.options || w.items) && (
                    <ul className="space-y-2">
                      {(w.options ?? w.items)?.map((i) => {
                        const remove = () =>
                          void mutate({ action: 'remove-item', card: w.id, item: i.id, previous: i.text })
                        const input = (
                          <Inline
                            completed={'done' in i && i.done}
                            label={'Edit ' + (w.options ? 'option' : 'item')}
                            value={i.text}
                            save={(value, previous) =>
                              mutate({ action: 'rename-item', card: w.id, item: i.id, value, previous })
                            }
                          />
                        )
                        return 'mine' in i ? (
                          <VoteOption
                            key={i.id}
                            n={i.voters.length}
                            max={Math.max(1, ...(w.options ?? []).map((o) => o.voters.length))}
                            mine={i.mine}
                            names={i.voters.join(', ')}
                            label={i.text}
                            toggle={() => edit(w.id, i.id, !i.mine)}
                            remove={remove}
                          >
                            {input}
                          </VoteOption>
                        ) : (
                          <CheckItem
                            key={i.id}
                            on={i.done}
                            label={i.text}
                            toggle={() => edit(w.id, i.id, !i.done)}
                            remove={remove}
                          >
                            {input}
                          </CheckItem>
                        )
                      })}
                    </ul>
                  )}
                  {(w.items || w.options) && (
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault()
                        const form = e.currentTarget
                        const value = new FormData(form).get('item')
                        if (value)
                          void mutate({ action: w.items ? 'append' : 'add-option', card: w.id, value })
                        form.reset()
                      }}
                    >
                      <input
                        className="h-9 min-w-0 flex-1 rounded-pill bg-white/70 px-4 text-sm"
                        name="item"
                        required
                        aria-label={w.items ? 'New item' : 'New option'}
                        placeholder={w.items ? 'add an item' : 'add an option'}
                        maxLength={200}
                      />
                      <Button small variant="cream" aria-label={w.items ? 'add item' : 'add option'}>
                        <Icon name="plus" size={14} />
                      </Button>
                    </form>
                  )}
                  {w.nativePoll && <NativePollStatus {...w.nativePoll} />}
                  {w.voteSummary && <p className="text-xs text-ink/55">{w.voteSummary}</p>}
                  {w.type === 'vote' && (
                    <PollDeadline
                      due={w.due}
                      question={w.title}
                      waiting={w.waiting ?? []}
                      link={board.invite}
                      onDue={(value) => void mutate({ action: 'due', card: w.id, value })}
                    />
                  )}
                  {w.by && <p className="text-xs text-ink/55">Shared by {w.by}</p>}
                  {w.type === 'note' && (
                    <>
                      <Inline
                        multiline
                        label="Note text"
                        value={w.text ?? ''}
                        save={(value, previous) => mutate({ action: 'field', card: w.id, value, previous })}
                      />
                      <p className="text-xs text-ink/55">— {w.title}</p>
                    </>
                  )}
                  {w.type === 'budget' && (
                    <PilotBudgetView
                      data={board.budget}
                      viewerId={board.viewerId}
                      savePersonal={(value) =>
                        api('edit', {
                          action: 'budget',
                          card: w.id,
                          currency: value.currency,
                          value: amountText(value).slice(4),
                        })
                      }
                      clearPersonal={() => api('edit', { action: 'clear-budget', card: w.id })}
                      saveTarget={(value) =>
                        api('edit', {
                          action: 'budget-target',
                          card: w.id,
                          currency: value.currency,
                          value: amountText(value).slice(4),
                        })
                      }
                      openExpenses={() => {
                        location.hash = 'budget'
                      }}
                    />
                  )}
                  {w.places && !w.places.length && <p>No saved places yet.</p>}
                  {w.usesPhoton && (
                    <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">
                      Place search via Photon · © OpenStreetMap contributors
                    </a>
                  )}
                  {w.places?.map((p) => (
                    <div key={p.id} className="mb-2 rounded-xl bg-white/60 p-2 text-xs">
                      <Inline
                        label="Place label"
                        value={p.label}
                        save={(value, previous) =>
                          mutate({ action: 'label', card: w.id, item: p.id, value, previous })
                        }
                      />
                      <small className="block text-ink/60">Shared by {p.by}</small>
                      {p.point ? (
                        <>
                          <p>
                            Map preview ·{' '}
                            <a href={'https://maps.google.com/?q=' + p.point.join(',')}>Open location</a>
                          </p>
                          <LocationMap
                            key={p.point.join(',')}
                            label={p.label}
                            location={{ lat: p.point[0], lon: p.point[1] }}
                          />
                        </>
                      ) : (
                        <p>
                          {p.url ? (
                            <>
                              Location unknown · <a href={p.url}>Open saved map link</a>
                            </>
                          ) : (
                            'Location unavailable. Request this place again in iMessage.'
                          )}
                        </p>
                      )}
                      <details>
                        <summary>Edit place</summary>
                        <button
                          onClick={() => void mutate({ action: 'remove-place', card: w.id, item: p.id })}
                        >
                          Remove place
                        </button>
                      </details>
                    </div>
                  ))}
                  {w.url && (
                    <a href={w.url} rel="noreferrer" target="_blank">
                      Open shared link
                    </a>
                  )}
                  {w.places &&
                    (!w.places.length ? (
                      <p>Waiting for a confirmed place.</p>
                    ) : (
                      <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>
                    ))}
                </div>
              )}
            />
          ))}
      </div>
      <WorkspaceTabs tab={tab} mobile />
    </main>
  )
}

function Inline({
  label,
  value,
  save,
  multiline,
  completed,
}: {
  label: string
  value: string
  save: (next: string, previous: string) => unknown
  completed?: boolean
  multiline?: boolean
}) {
  const [draft, setDraft] = useState<{ previous: string; text: string } | null>(null)
  const props = {
    'aria-label': label,
    value: draft?.text ?? value,
    className:
      'min-w-0 flex-1 bg-transparent focus:bg-white/70 ' +
      (label === 'Vote question' || label === 'List title'
        ? 'text-lg font-semibold lowercase'
        : label === 'Edit option'
          ? 'relative text-sm font-semibold lowercase'
          : completed
            ? 'text-ink/40 line-through'
            : ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft({ previous: draft?.previous ?? value, text: e.target.value }),
    onBlur: () => {
      if (draft && draft.text !== draft.previous) save(draft.text, draft.previous)
      setDraft(null)
    },
  }
  return multiline ? (
    <NoteField {...props} />
  ) : (
    <input
      {...props}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}
