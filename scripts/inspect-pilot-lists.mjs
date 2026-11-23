// Read-only checklist reply status. No credentials, raw commands, replies or handles are printed.
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
  console.log(JSON.stringify({ tripId, replies: [...doc.getMap('pilotListDeliveries')].map(([messageId, job]) => {
    const outcome = doc.getMap('pilotMessageReceipts').get(messageId)?.outcome
    return { messageId, state: job.state, reason: job.reason, widgetId: outcome?.widgetId, changed: outcome?.changed }
  }) }, null, 2))
} catch { console.error('Cannot read checklist reply metadata; check the trip and persistent directory.'); process.exitCode = 1 }
finally { doc.destroy() }
