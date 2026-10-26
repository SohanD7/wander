import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type * as Y from 'yjs'
import { toneFor, useSession, type Session, type Tone } from '../lib/session'
import { makeActions, applySnapshot, pushFeed, type Actions } from './actions'
import { acquireRoom, releaseRoom, type ConnectionStatus, type TripRoom } from './room'
import { CREW, DEMO_TRIPS, PCH_SNAPSHOT, seedFeed } from './seed'
import type { TripType } from './types'
import { findTrip } from '../lib/trips'

interface Ctx {
  room: TripRoom
  actions: Actions
}
const TripCtx = createContext<Ctx | null>(null)

/**
 * Joins the trip's shared document, announces this session in `members` + awareness, and seeds
 * the demo data exactly once (deterministic ids + a `seeded` flag make a double-seed harmless).
 */
export function TripProvider({ tripId, children }: { tripId: string; children: ReactNode }) {
  const { session } = useSession()
  const [room, setRoom] = useState<TripRoom | null>(null)

  useEffect(() => {
    const r = acquireRoom(tripId)
    setRoom(r)
    return () => releaseRoom(tripId)
  }, [tripId])

  if (!room || !session) return null
  return <Joined room={room} session={session} tripId={tripId}>{children}</Joined>
}

function Joined({ room, session, tripId, children }: { room: TripRoom; session: Session; tripId: string; children: ReactNode }) {
  const actions = useMemo(() => makeActions(room, session), [room, session])

  useEffect(() => {
    room.awareness.setLocalStateField('user', { id: session.id, name: session.name, tone: session.tone })
    return () => room.awareness.setLocalState(null)
  }, [room, session])

  useEffect(() => {
    let done = false
    const run = () => {
      if (done) return
      done = true
      const demo = DEMO_TRIPS[tripId as keyof typeof DEMO_TRIPS]
      const local = findTrip(tripId)
      room.doc.transact(() => {
        if (!room.meta.get('seeded')) {
          if (tripId === 'pch-roadtrip') {
            applySnapshot(room, PCH_SNAPSHOT)
            CREW.forEach((m) => room.members.set(m.id, m))
            seedFeed(Date.now()).forEach((f) => room.feed.push([f]))
            room.meta.set('seeded', true)
          } else if (local || demo) {
            // The creator (or a demo-id visitor) sets the trip's identity once.
            const src = local ?? { ...demo!, start: '', end: '' }
            room.meta.set('name', src.name)
            room.meta.set('type', src.type)
            room.meta.set('place', src.place)
            room.meta.set('start', src.start)
            room.meta.set('end', src.end)
            room.meta.set('budget', 0)
            room.meta.set('seeded', true)
            room.members.set(session.id, { id: session.id, name: session.name, tone: session.tone, status: 'organizer' })
            ;(local?.invited ?? []).forEach((n) => {
              const id = `inv-${n.toLowerCase().replace(/[^a-z0-9]/g, '')}`
              room.members.set(id, { id, name: n.split('@')[0], tone: toneFor(id), status: 'invited' })
            })
            pushFeed(room, session, `created ${src.name}`)
          }
        }
        if (!room.members.has(session.id)) {
          room.members.set(session.id, { id: session.id, name: session.name, tone: session.tone, status: 'joined' })
          if (room.meta.get('seeded')) pushFeed(room, session, 'joined the trip space')
        }
      })
    }
    // Wait for the relay's state first (so we don't seed over it); fall back if offline.
    const timer = setTimeout(run, 1500)
    const unsub = room.subscribe(() => {
      if (room.synced) {
        clearTimeout(timer)
        run()
      }
    })
    if (room.synced) run()
    return () => {
      clearTimeout(timer)
      unsub()
    }
  }, [room, session, tripId])

  return <TripCtx.Provider value={{ room, actions }}>{children}</TripCtx.Provider>
}

export function useTrip() {
  const c = useContext(TripCtx)
  if (!c) throw new Error('useTrip must be used inside <TripProvider>')
  return c
}

/** Live JSON view of a Y.Map (re-renders on any local or remote change). */
export function useYMap<T>(map: Y.Map<T>): Record<string, T> {
  const [snap, setSnap] = useState(() => map.toJSON() as Record<string, T>)
  useEffect(() => {
    const update = () => setSnap(map.toJSON() as Record<string, T>)
    update()
    map.observe(update)
    return () => map.unobserve(update)
  }, [map])
  return snap
}

export function useYArray<T>(arr: Y.Array<T>): T[] {
  const [snap, setSnap] = useState(() => arr.toArray())
  useEffect(() => {
    const update = () => setSnap(arr.toArray())
    update()
    arr.observe(update)
    return () => arr.unobserve(update)
  }, [arr])
  return snap
}

export function useConnection(): ConnectionStatus {
  const { room } = useTrip()
  return useSyncExternalStore(
    (cb) => room.subscribe(cb),
    () => room.status,
  )
}

export interface Peer {
  clientId: number
  user: { id: string; name: string; tone: Tone }
  cursor: { x: number; y: number } | null
  isMe: boolean
}

/** Everyone currently in the room (including me), from Yjs awareness. */
export function usePeers(): Peer[] {
  const { room } = useTrip()
  const read = () => {
    const out: Peer[] = []
    room.awareness.getStates().forEach((s, clientId) => {
      if (!s.user) return
      out.push({ clientId, user: s.user, cursor: s.cursor ?? null, isMe: clientId === room.awareness.clientID })
    })
    return out.sort((a, b) => a.clientId - b.clientId)
  }
  const [peers, setPeers] = useState<Peer[]>(read)
  useEffect(() => {
    const update = () => setPeers(read())
    update()
    room.awareness.on('change', update)
    return () => room.awareness.off('change', update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room])
  return peers
}

export type { TripType }
