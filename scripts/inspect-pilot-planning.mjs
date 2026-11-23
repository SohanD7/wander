// Read-only status metadata; no credentials, raw commands, amounts, labels, URLs or phone handles.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import * as Y from 'yjs'
import '../server/zerosettle-env.mjs'
const tripId = process.env.ZEROSETTLE_TRIP_ID ?? 'pilot-lisbon-demo'
const dir = process.env.PILOT_DATA_DIR ?? './data/zerosettle-pilot'
const file = path.join(dir, crypto.createHash('sha256').update(`wander-${tripId}`).digest('hex').slice(0, 32) + '.ydoc')
const doc = new Y.Doc()
try {
  Y.applyUpdate(doc, new Uint8Array(fs.readFileSync(file)))
  console.log(JSON.stringify({ tripId, submittedBudgetCount: doc.getMap('budgetPreferences').size, savedPlaceCount: doc.getMap('savedPlaces').size,
    pending: [...doc.getMap('pendingPlaces')].map(([id, p]) => ({ id, status: p.status, expiresAt: p.expiresAt })),
    replies: ['pilotBudgetDeliveries', 'pilotPlaceDeliveries'].flatMap((map) => [...doc.getMap(map)].map(([messageId, job]) => ({ feature: map, messageId, state: job.state, reason: job.reason }))),
    lookups: [...doc.getMap('pilotPlaceLookups')].map(([messageId, job]) => ({ messageId, state: job.state })),
  }, null, 2))
} catch { console.error('Cannot read planning metadata; check the trip and persistent directory.'); process.exitCode = 1 }
finally { doc.destroy() }
