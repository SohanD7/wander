import type * as Y from 'yjs'
import { ARTIFACT } from '../lib/env'
import { acquireRoom, releaseRoom } from './room'

/**
 * Empties a trip's shared document for everyone connected (there is no server-side delete — the document
 * itself is the source of truth). `tombstone` marks it deleted so anyone still inside sees a
 * "this trip was deleted" screen and it can never be re-seeded; without it (demo copies) the room is
 * simply blank, so the next open re-seeds a fresh demo.
 */
export async function wipeTripRoom(id: string, tombstone: boolean): Promise<void> {
  const room = acquireRoom(id)
  try {
    if (!ARTIFACT && !room.synced) {
      // wait for the server's copy so we clear the real data, not an empty local doc (give up after 2.5s)
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); off(); resolve() }
        const timer = setTimeout(done, 2500)
        const off = room.subscribe(() => room.synced && done())
        if (room.synced) done()
      })
    }
    room.doc.transact(() => {
      ;([room.meta, room.widgets, room.votes, room.checks, room.days, room.stops, room.expenses, room.paid, room.members] as Y.Map<unknown>[]).forEach((m) => m.clear())
      room.feed.delete(0, room.feed.length)
      if (tombstone) room.meta.set('deleted', true)
    })
    if (!ARTIFACT) await new Promise((r) => setTimeout(r, 400)) // let the websocket flush before we disconnect
  } finally {
    releaseRoom(id)
  }
}
