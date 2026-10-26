import type { TripType } from '../collab/types'
import { DEMO_TRIPS } from '../collab/seed'

/**
 * "My trips" is just a per-browser bookmark list — there is no database. The trip *contents* live in
 * the shared Yjs document; this only remembers which trips this browser has opened or created.
 */
export interface TripRef {
  id: string
  name: string
  type: TripType
  place: string
  start: string
  end: string
  vibes?: string[]
  /** names / emails picked in the new-trip crew step — shown as 'invited' members */
  invited?: string[]
}

const KEY = 'wander.trips.v1'

export function readTrips(): TripRef[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as TripRef[]
  } catch {
    return []
  }
}

function write(t: TripRef[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(t))
  } catch {
    /* storage unavailable — list just won't persist */
  }
}

export function saveTrip(t: TripRef) {
  write([t, ...readTrips().filter((x) => x.id !== t.id)])
}

export function findTrip(id: string): TripRef | undefined {
  return readTrips().find((t) => t.id === id)
}

export function demoTrips(): TripRef[] {
  return Object.entries(DEMO_TRIPS).map(([id, t]) => ({ id, ...t, start: '', end: '' }))
}

export function tripSlug(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trip'
  return `${base}-${Math.random().toString(36).slice(2, 6)}`
}
