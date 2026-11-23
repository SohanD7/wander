// Read-only persisted poll delivery metadata; never print credentials, payloads or participant handles.
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
  console.log(JSON.stringify({ tripId,
    polls: [...doc.getMap('pilotNativePolls')].map(([commandId, poll]) => {
      const job = doc.getMap('pilotPollDeliveries').get(`native.${commandId}`)
      return { commandId, widgetId: poll.widgetId, state: job?.state, reason: job?.reason, providerMessageId: poll.providerMessageId,
        mappingReady: !!poll.optionMap, optionCount: poll.options.length }
    }),
    replies: [...doc.getMap('pilotPollDeliveries')].filter(([, job]) => job.kind === 'text').map(([id, job]) => ({ id, state: job.state, reason: job.reason })),
    pendingVotes: doc.getMap('pilotPendingPollVotes').size,
  }, null, 2))
} catch { console.error('Cannot read pilot poll metadata; check the trip and persistent data directory.'); process.exitCode = 1 }
finally { doc.destroy() }
