import { useEffect, useState } from 'react'
import { LocationMap } from '../space/LocationMap'
import { Button } from '../../components/ui/Button'
import { LockKeyhole, Check } from 'lucide-react'
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
  type: string
  title: string
  text?: string
  url?: string
  by?: string
  status?: string
  rows?: string[]
  usesPhoton?: boolean
  ranges?: string[]
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
  if (!response.ok) throw new Error(result.error || 'Please try again.')
  return result
}
export function HostedTrip() {
  if (location.pathname.startsWith('/t/')) return <Canvas />
  if (!trip)
    return (
      <main className="claim-panel">
        <h1>Wander</h1>
        <p>Open the invitation from your group chat to join your trip.</p>
      </main>
    )
  return <Claim />
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
                    <b key={i}>{code[i] || '·'}</b>
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
    <main className="hosted-board bg-dot-grid">
      <header>
        <h1>{board?.title || 'Trip canvas'}</h1>
        <span role="status">{status}</span>
        <button
          onClick={() => {
            const value = window.prompt('New note')
            if (value) void mutate({ action: 'add-note', value })
          }}
        >
          Add note
        </button>
        <button
          onClick={() =>
            navigator.clipboard
              .writeText(invite)
              .then(() => setStatus('Invitation copied'))
              .catch(() => fail('Copy the invitation from your group chat.'))
          }
        >
          Copy invite
        </button>
        <button
          onClick={async () => {
            await api('logout', {})
            location.replace(invite || '/')
          }}
        >
          Log out
        </button>
      </header>
      {welcome && (
        <button className="claim-welcome" onClick={() => setWelcome('')}>
          {welcome} ×
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="hosted-space">
        {board?.cards.map((w) => (
          <section
            key={w.id}
            className="hosted-card"
            style={{ left: w.x, top: w.y, width: w.w || 360, minHeight: w.h }}
          >
            <h2
              draggable
              title="Drag to move card"
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', w.id)
                e.currentTarget.dataset.start = e.clientX + ',' + e.clientY
              }}
              onDragEnd={(e) => {
                const [x, y] = (e.currentTarget.dataset.start || '').split(',').map(Number)
                if (Number.isFinite(x) && e.clientX > 0)
                  void mutate({
                    action: 'move',
                    card: w.id,
                    x: Math.max(0, w.x + e.clientX - x),
                    y: Math.max(0, w.y + e.clientY - y),
                  })
              }}
            >
              {w.title}
            </h2>
            {w.by && <small>Shared by {w.by}</small>}
            {w.status && (
              <p role="status">
                {w.type === 'vote' && 'iMessage poll · '}
                {w.status}
              </p>
            )}
            {w.options?.map((o) => (
              <button
                key={o.id}
                title={o.voters.join(', ')}
                aria-pressed={o.mine}
                onClick={() => edit(w.id, o.id, !o.mine)}
              >
                {o.text}
                <b>{o.voters.length}</b>
              </button>
            ))}
            {w.items?.map((i) => (
              <label key={i.id}>
                <input type="checkbox" checked={i.done} onChange={() => edit(w.id, i.id, !i.done)} /> {i.text}
              </label>
            ))}
            {w.text && <p className="whitespace-pre-wrap">{w.text}</p>}
            {w.rows?.map((r, i) => (
              <p key={i}>{r}</p>
            ))}
            {w.places && !w.places.length && <p>No saved places yet.</p>}
            {w.usesPhoton && (
              <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">
                Place search via Photon · © OpenStreetMap contributors
              </a>
            )}
            {w.places?.map((p, i) => (
              <div key={i}>
                <b>{p.label}</b>
                <small className="block">Shared by {p.by}</small>
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
                    onClick={() => {
                      const value = window.prompt('Place label', p.label)
                      if (value) void mutate({ action: 'label', card: w.id, item: p.id, value })
                    }}
                  >
                    Rename
                  </button>
                  <button onClick={() => void mutate({ action: 'remove-place', card: w.id, item: p.id })}>
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
            {w.type === 'note' && (
              <button
                onClick={() => {
                  const value = window.prompt('Edit note', w.text)
                  if (value) void mutate({ action: 'note', card: w.id, previous: w.text, value })
                }}
              >
                Edit note
              </button>
            )}
            {w.items && (
              <button
                onClick={() => {
                  const value = window.prompt('Checklist item')
                  if (value) void mutate({ action: 'append', card: w.id, value })
                }}
              >
                Add item
              </button>
            )}
            {w.rows && (
              <>
                <small>Per person · total trip</small>
                {w.ranges?.map((r) => (
                  <p key={r}>Range: {r}</p>
                ))}
                <details>
                  <summary>My preference</summary>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      const data = new FormData(e.currentTarget)
                      void mutate({
                        action: 'budget',
                        card: w.id,
                        currency: data.get('currency'),
                        value: data.get('amount'),
                      })
                    }}
                  >
                    <input aria-label="Currency" name="currency" defaultValue="USD" size={4} maxLength={3} />
                    <input aria-label="Amount" name="amount" required inputMode="decimal" />
                    <button>Save budget</button>
                  </form>
                  <button onClick={() => void mutate({ action: 'clear-budget', card: w.id })}>
                    Clear my budget
                  </button>
                </details>
              </>
            )}
            {w.places &&
              (!w.places.length ? (
                <p>Waiting for a confirmed place.</p>
              ) : (
                <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>
              ))}
          </section>
        ))}
      </div>
    </main>
  )
}
