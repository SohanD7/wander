import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { ARTIFACT } from '../lib/env'
import type { Day, Expense, FeedItem, Member, Stop, Widget } from './types'

/**
 * One Yjs document per trip. No database: state lives in the websocket relay's memory
 * (`npm run dev:sync`) and in each connected browser. Tabs in the same browser also sync
 * through BroadcastChannel (built into y-websocket), so the app still works if the relay is down.
 *
 * Granularity matters for conflicts — things many people touch at once are one key per fact:
 *   votes  `${widgetId}|${optionId}|${userId}` → timestamp   (a vote can't be lost to a race)
 *   checks `${widgetId}|${itemId}`             → boolean
 * Everything else is last-writer-wins per entity (a widget, a stop, an expense).
 */
export function syncUrl(): string {
  const env = import.meta.env.VITE_SYNC_URL as string | undefined
  if (env) return env
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.hostname}:1234`
}

export type ConnectionStatus = 'connecting' | 'connected' | 'offline'

export class TripRoom {
  readonly id: string
  readonly doc = new Y.Doc()
  readonly provider: WebsocketProvider
  readonly awareness: WebsocketProvider['awareness']

  readonly meta = this.doc.getMap<string | number | boolean>('meta')
  readonly widgets = this.doc.getMap<Widget>('widgets')
  readonly votes = this.doc.getMap<number>('votes')
  readonly checks = this.doc.getMap<boolean>('checks')
  readonly days = this.doc.getMap<Day>('days')
  readonly stops = this.doc.getMap<Stop>('stops')
  readonly expenses = this.doc.getMap<Expense>('expenses')
  readonly paid = this.doc.getMap<boolean>('paid')
  readonly members = this.doc.getMap<Member>('members')
  readonly feed = this.doc.getArray<FeedItem>('feed')

  status: ConnectionStatus = ARTIFACT ? 'offline' : 'connecting'
  synced = false
  private listeners = new Set<() => void>()
  refs = 0

  constructor(id: string) {
    this.id = id
    this.provider = new WebsocketProvider(syncUrl(), `wander-${id}`, this.doc, { connect: !ARTIFACT })
    this.awareness = this.provider.awareness
    this.provider.on('status', (e: { status: string }) => {
      this.status = e.status === 'connected' ? 'connected' : e.status === 'connecting' ? 'connecting' : 'offline'
      this.emit()
    })
    this.provider.on('sync', (isSynced: boolean) => {
      this.synced = isSynced
      this.emit()
    })
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  private emit() {
    this.listeners.forEach((l) => l())
  }

  destroy() {
    this.provider.destroy()
    this.doc.destroy()
  }
}

const rooms = new Map<string, TripRoom>()

export function acquireRoom(id: string): TripRoom {
  let room = rooms.get(id)
  if (!room) {
    room = new TripRoom(id)
    rooms.set(id, room)
  }
  room.refs++
  return room
}

export function releaseRoom(id: string) {
  const room = rooms.get(id)
  if (!room) return
  room.refs--
  // Defer so React StrictMode's mount→unmount→mount doesn't tear the connection down.
  setTimeout(() => {
    if (room.refs <= 0 && rooms.get(id) === room) {
      room.destroy()
      rooms.delete(id)
    }
  }, 250)
}
