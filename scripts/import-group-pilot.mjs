// Run offline, before the first start-a-trip command. Never overwrite a hosted trip.
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import * as Y from 'yjs'
import '../server/zerosettle-env.mjs'
import { normalizeHandle, zeroSettleSenderId } from '../server/zerosettle-protocol.mjs'
import { testerNames } from '../server/zerosettle.mjs'
import { database } from '../server/hosted/database.mjs'
import { hostedDatabaseUrl } from '../server/hosted/connection.mjs'
const url = hostedDatabaseUrl()
const {
  ZEROSETTLE_ACCOUNT_SCOPE: scope,
  ZEROSETTLE_CHAT_ID: chat,
  ZEROSETTLE_TRIP_ID: oldTrip,
  ZEROSETTLE_IMPORT_LINE: line,
  PILOT_DATA_DIR: dir,
} = process.env
if (!url || !scope || !chat || !oldTrip || !dir || !line)
  throw Error('Set the database, scope, pilot chat/trip, import line and snapshot directory.')
const name =
  createHash('sha256')
    .update('wander-' + oldTrip)
    .digest('hex')
    .slice(0, 32) + '.ydoc'
const original = fs.readFileSync(path.join(dir, name)),
  doc = new Y.Doc()
Y.applyUpdate(doc, original)
if (!doc.getMap('meta').get('seeded') || doc.getMap('meta').get('deleted'))
  throw Error('Invalid pilot snapshot')
// Keep historical receipts and votes. Unsent historical jobs require operator review.
for (const map of [
  'pilotBudgetDeliveries',
  'pilotPlaceDeliveries',
  'pilotAcknowledgments',
  'pilotListDeliveries',
  'pilotPollDeliveries',
])
  for (const [id, j] of doc.getMap(map))
    if (['pending', 'sending'].includes(j.state))
      doc.getMap(map).set(id, { ...j, state: 'uncertain', reason: 'offline_import' })
// A deferred historical lookup/link can itself enqueue a new send. Retain the private
// original backup; leave the imported record visible and require a fresh user request.
for (const [id, j] of doc.getMap('pilotPlaceLookups'))
  if (['pending', 'running'].includes(j.state)) {
    doc.getMap('pilotPlaceLookups').set(id, { ...j, state: 'done' })
    const pending = doc.getMap('pendingPlaces').get(j.pendingId)
    if (pending)
      doc
        .getMap('pendingPlaces')
        .set(j.pendingId, { ...pending, status: 'unresolved', reason: 'offline_import' })
  }
doc.getMap('pilotMapLinkFragments').clear()
const db = database({ url })
try {
  db.query('BEGIN')
  const rows = db.query(
    'INSERT INTO wander_trip(id,scope,line,chat,title,snapshot) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(scope,line,chat) DO NOTHING RETURNING id',
    [
      randomUUID(),
      scope,
      line,
      chat,
      doc.getMap('meta').get('name'),
      Buffer.from(Y.encodeStateAsUpdate(doc)),
    ],
  )
  if (rows.length) {
    const names = testerNames(process.env.ZEROSETTLE_TESTER_NAMES ?? {})
    const handles = new Set(
      [...(process.env.ZEROSETTLE_TESTER_HANDLES ?? '').split(','), ...Object.keys(names)]
        .map((h) => normalizeHandle(h.trim()))
        .filter(Boolean),
    )
    for (const h of handles) {
      const label = names[h] ?? doc.getMap('members').get(zeroSettleSenderId(h))?.name
      if (label && label !== h)
        db.query(
          'INSERT INTO wander_member(trip,handle,picker,imported_name,active) VALUES($1,$2,$3,$4,false)',
          [rows[0].id, h, randomUUID(), label],
        )
    }
  }
  db.query('COMMIT')
  console.log(
    rows.length
      ? 'Imported pilot snapshot. Original file retained.'
      : 'Existing hosted trip preserved. No import performed.',
  )
} catch (e) {
  db.query('ROLLBACK')
  throw e
} finally {
  doc.destroy()
  await db.close()
}
