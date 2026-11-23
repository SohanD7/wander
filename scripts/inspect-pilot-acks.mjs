// Read persisted delivery state without credentials, URLs, message bodies, or phone numbers.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import * as Y from 'yjs'
import '../server/zerosettle-env.mjs'
const tripId = process.env.ZEROSETTLE_TRIP_ID ?? 'pilot-lisbon-demo'
const dataDir = process.env.PILOT_DATA_DIR ?? process.env.DATA_DIR ?? './data/zerosettle-pilot'
const name = crypto.createHash('sha256').update(`wander-${tripId}`).digest('hex').slice(0, 32) + '.ydoc'
const doc = new Y.Doc()
try {
  Y.applyUpdate(doc, fs.readFileSync(path.join(dataDir, name)))
  console.log(JSON.stringify([...doc.getMap('pilotAcknowledgments')].map(([messageId, item]) => ({
    messageId, state: item.state, providerMessageId: item.providerMessageId, reason: item.reason,
    createdAt: item.createdAt, attemptedAt: item.attemptedAt, finishedAt: item.finishedAt,
  })), null, 2))
} catch { console.error('Cannot read pilot acknowledgment state; check the configured data directory and trip.'); process.exitCode = 1 }
finally { doc.destroy() }
