import { normalizeHandle, zeroSettleSenderId } from './zerosettle-protocol.mjs'
import { createMapLinkBridge } from './pilot-map-links.mjs'
import crypto from 'node:crypto'
import { wandaCommandText } from './wanda-command.mjs'
import { createCommandFeature } from './pilot-command-feature.mjs'
import { ensureSummaryCard } from './zerosettle-budget.mjs'
import { parseMapLink, parseCoordinates, validLocation, normalizePlaceName, placeName, placeChoice } from '../src/collab/pilot-places.mjs'
import { createGeocoder } from './pilot-geocoder.mjs'
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)
const PENDING_MS = 30 * 60000
export function parseWandaPlace(text) {
  const command = wandaCommandText(text)
  if (!command || !/^(?:choose\b|places?\b|remove\s+place\b|confirm\s+place\b|locate\s+place\b)/i.test(command)) return null
  if ([...text].length > 2500) return { error: 'That place command is too long. Please shorten it to 2,500 characters.' }
  if (/^places\s*$/i.test(command)) return { action: 'list' }
  if (/^choose\b/i.test(command)) {
    const choice = /^choose\s+([1-3])\s*$/i.exec(command)
    return choice ? { action: 'choose', index: Number(choice[1]) - 1 } : { error: 'Choose a number from Wanda’s place reply. Try @Wanda choose 1.' }
  }
  if (/^place\s*$/i.test(command)) return { action: 'await_link' }
  const confirm = /^confirm\s+place\s+(p_[a-f0-9]{16})(?:\s+([1-3]))?\s*$/i.exec(command)
  if (confirm) return { action: 'confirm', pendingId: confirm[1].toLowerCase(), index: confirm[2] ? Number(confirm[2]) - 1 : undefined }
  const locate = /^locate\s+place\s+(sp_[a-f0-9]{16})\s*\|\s*(.+)$/i.exec(command)
  if (locate) {
    const coordinates = parseCoordinates(locate[2])
    return coordinates ? { action: 'locate', placeId: locate[1].toLowerCase(), coordinates } : { error: `Use latitude, longitude within −90…90 and −180…180. Example: @Wanda locate place ${locate[1].toLowerCase()} | 47.60,-122.34` }
  }
  const remove = /^remove\s+place\s+(.+)$/i.exec(command)
  if (remove) return { action: 'remove', value: remove[1].trim() }
  const place = /^place\s+(.+)$/i.exec(command)
  if (place) {
    const value = place[1].trim()
    if (/^[a-z][a-z\d+.-]*:|^www\.|^\/\//i.test(value)) {
      const parsed = parseMapLink(value)
      return parsed.error ? parsed : { action: 'url', ...parsed }
    }
    if ([...value].length > 200 || /[\r\n]/.test(value)) return { error: 'Please use a single place name of at most 200 characters.' }
    return { action: 'name', value }
  }
  if (/^confirm\b/i.test(command)) return { error: 'Reply to Wanda’s place choices with a number, or use @Wanda choose 1.' }
  if (/^locate\b/i.test(command)) return { error: 'Use a saved place ID from @Wanda places, then | latitude,longitude.' }
  if (/^remove\b/i.test(command)) return { error: 'Please include a saved place name or ID from @Wanda places.' }
  if (/^places\b/i.test(command)) return { error: 'Use @Wanda places to list saved places.' }
  return { error: 'Please include a place name. Try @Wanda place Pike Place Market, Seattle.' }
}
function choiceReply(pending) {
  if (!pending.candidates?.length) return `I couldn’t find a location for “${pending.query}”. Add a city or address and try @Wanda place again.`
  return ['Which place did you mean?', ...pending.candidates.map((c, i) => `${i + 1}. ${placeChoice(c)}`), `Reply to this message with ${pending.candidates.map((_, i) => i + 1).join(', ')}.`, ...(pending.candidates.some((c) => c.provider === 'photon') ? ['© OpenStreetMap contributors · https://www.openstreetmap.org/copyright'] : [])].join('\n')
}
export function createPilotPlaces(options) {
  const { config, persistNow } = options
  if (!config?.places) return null
  let feature, running, closed = false
  const abort = new AbortController()
  function pendingRecord(doc, context, query, candidates, targetPlaceId, sourceUrl) {
    const map = doc.getMap('pendingPlaces'), now = Date.now()
    for (const [id, p] of map) if (!['confirmed', 'expired'].includes(p.status) && p.expiresAt <= now) map.set(id, { ...p, status: 'expired' })
    const key = `${context.senderId}|${targetPlaceId ?? ''}|${normalizePlaceName(query)}`
    const previous = [...map.values()].find((p) => p.key === key && p.expiresAt > now && !['confirmed', 'expired'].includes(p.status))
    if (previous && previous.status !== 'unresolved') return { record: previous, existing: true }
    if ([...map.values()].filter((p) => p.expiresAt > now && !['confirmed', 'expired'].includes(p.status)).length >= 20) return { error: 'There are too many pending places. Confirm one or wait for it to expire.' }
    const id = previous?.id ?? 'p_' + hash(context.messageId)
    const record = { id, key, senderId: context.senderId, name: context.name, chatId: config.chatId, query, candidates: candidates ?? [], status: candidates ? 'awaiting_confirmation' : 'lookup_pending', expiresAt: now + PENDING_MS, ...(targetPlaceId ? { targetPlaceId } : {}), ...(sourceUrl ? { url: sourceUrl } : {}) }
    map.set(id, record)
    while (map.size > 200) { const old = [...map].find(([, p]) => ['confirmed', 'expired'].includes(p.status)); if (!old) break; map.delete(old[0]) }
    return { record, existing: false }
  }
  function replyPending(doc, replyTo) {
    const entry = [...doc.getMap('pilotPlaceDeliveries')].find(([, job]) => job.state === 'sent' && ((replyTo.id != null && String(job.providerMessageId) === String(replyTo.id)) || (replyTo.guid && job.providerGuid === replyTo.guid)))
    return entry && doc.getMap('pilotMessageReceipts').get(entry[0])?.outcome?.pendingId
  }
  function selection(context) {
    if (!/^\s*[1-3]\s*$/.test(context.text) || !context.replyTo) return null
    const r = feature.room()
    const pendingId = r && replyPending(r.doc, context.replyTo)
    return pendingId ? { action: 'choose', pendingId, index: Number(context.text.trim()) - 1 } : null
  }
  const displayName = (doc, id, p) => doc.getMap('savedPlaceLabels').get(id) ?? p.label
  feature = createCommandFeature({ ...options, enabled: true, mapName: 'pilotPlaceDeliveries', commandName: 'wanda-places', apply: (doc, context, parsed) => {
    const fail = (reply) => ({ reply, changed: false })
    if (parsed.error) return fail(parsed.error)
    if (parsed.action === 'await_link') {
      if (parsed.fragment && doc.getMap('pilotMapLinkFragments').size < 128) doc.getMap('pilotMapLinkFragments').set(context.messageId, parsed.fragment)
      return fail('Please reply to this message with the map link.')
    }
    if (parsed.pairedFragment) {
      doc.getMap('pilotMapLinkFragments').delete(parsed.pairedFragment)
      doc.getMap('pilotLinkFragments').delete(parsed.pairedFragment)
      doc.getMap('pilotLinkFragments').delete(context.messageId)
      const other = parsed.pairedContext, receipts = doc.getMap('pilotMessageReceipts')
      if (!receipts.has(other.messageId)) receipts.set(other.messageId, { senderId: other.senderId, text: other.text, command: 'wanda-places', outcome: { changed: false, correlated: context.messageId } })
    }
    if (parsed.action === 'choose') {
      const pendingMap = doc.getMap('pendingPlaces')
      let pendingId = parsed.pendingId
      if (!pendingId && context.replyTo) pendingId = replyPending(doc, context.replyTo)
      if (!pendingId && !context.replyTo) {
        const active = [...pendingMap.values()].filter((p) => p.senderId === context.senderId && p.chatId === config.chatId && p.expiresAt > Date.now() && !['confirmed', 'expired'].includes(p.status))
        if (active.length !== 1) return fail(active.length ? 'Please reply directly to the place choices with a number.' : 'No active place lookup. Send @Wanda place with the name.')
        pendingId = active[0].id
      }
      if (!pendingId) return fail('Please reply directly to Wanda’s place choices with a number.')
      parsed = { action: 'confirm', pendingId, index: parsed.index }
    }
    const places = doc.getMap('savedPlaces'), labels = doc.getMap('savedPlaceLabels'), locations = doc.getMap('placeLocations')
    const widgetId = ensureSummaryCard(doc, 'map', 'saved-places', 'w_saved_places')
    if (parsed.action === 'list') {
      const rows = [...places].map(([id, p]) => `${displayName(doc, id, p)} · ${validLocation(locations.get(id)) ? 'confirmed location' : p.url ? 'map link, location unknown' : 'location unknown'}`)
      const reply = rows.length ? 'Saved places:\n' + rows.join('\n') : 'No saved places yet. Try @Wanda place Pike Place Market, Seattle.'
      return { reply: reply.length > 3400 ? reply.slice(0, 3250) + '\n… See all places on the board.' : reply, changed: false, widgetId }
    }
    if (parsed.action === 'remove') {
      const matches = [...places].filter(([id, p]) => id.toLowerCase() === parsed.value.toLowerCase() || normalizePlaceName(displayName(doc, id, p)) === normalizePlaceName(parsed.value) || (!labels.has(id) && p.submittedName && normalizePlaceName(p.submittedName) === normalizePlaceName(parsed.value)))
      if (!matches.length) return fail('I couldn’t find that saved place. Check @Wanda places for its name or ID.')
      if (matches.length > 1) return fail('Several places match. Remove one by ID:\n' + matches.slice(0, 3).map(([id, p]) => `${displayName(doc, id, p)}: @Wanda remove place ${id}`).join('\n'))
      const [id, p] = matches[0], label = displayName(doc, id, p)
      places.delete(id); labels.delete(id); locations.delete(id)
      return { reply: `Removed ${label}.`, changed: true, widgetId, placeId: id }
    }
    if (parsed.action === 'confirm') {
      const pending = doc.getMap('pendingPlaces').get(parsed.pendingId)
      if (!pending) return fail('That place request is missing or expired. Send @Wanda place with the name again.')
      if (pending.senderId !== context.senderId || pending.chatId !== config.chatId) return fail('Only the tester who requested this place can confirm it.')
      if (pending.status === 'confirmed') return fail('That place was already confirmed. Check @Wanda places.')
      if (pending.expiresAt <= Date.now() || pending.status === 'expired') return fail('That place request expired. Send @Wanda place with the name again.')
      if (pending.status === 'lookup_pending') return fail('Still looking up that place. Please wait for the choices.')
      if (!pending.candidates?.length) return fail('There’s no location to confirm yet. Try a fuller name with @Wanda place.')
      const index = parsed.index ?? (pending.candidates.length === 1 ? 0 : -1), candidate = pending.candidates[index]
      if (!candidate) return fail(choiceReply(pending))
      if (!validLocation(candidate)) return fail('That result has invalid coordinates. Please request the place again.')
      const dedupeKey = candidate.providerId ?? `point:${candidate.lat},${candidate.lon}`
      const duplicate = [...places].find(([, p]) => p.dedupeKey === dedupeKey && !pending.targetPlaceId)
      const id = pending.targetPlaceId ?? duplicate?.[0] ?? 'sp_' + hash(dedupeKey)
      if (pending.targetPlaceId && !places.has(id)) return fail('That saved link was removed. Save it again before adding its location.')
      if (!places.has(id) && places.size >= 100) return fail('The pilot has 100 saved places. Remove one before saving another.')
      if (!places.has(id)) places.set(id, { id, label: placeName(candidate), resolvedLabel: candidate.label, ...(pending.url ? { url: pending.url } : {}), ...(candidate.provider === 'photon' ? { submittedName: pending.query } : {}), dedupeKey, createdAt: Date.now(), source: { senderId: context.senderId, name: context.name } })
      if (!duplicate) locations.set(id, { lat: candidate.lat, lon: candidate.lon, provider: candidate.provider, attribution: candidate.attribution, confirmedBy: context.senderId, confirmedAt: Date.now() })
      doc.getMap('pendingPlaces').set(pending.id, { ...pending, status: 'confirmed', placeId: id })
      return { reply: `${duplicate ? 'Already added' : 'Added'} ${labels.get(id) ?? placeName(places.get(id))} to the map.`, changed: !duplicate, placeId: id, widgetId }
    }
    if (parsed.action === 'url' && !parsed.coordinates) {
      const key = 'url:' + parsed.url, existing = [...places].find(([, p]) => p.dedupeKey === key), id = existing?.[0] ?? 'sp_' + hash(key)
      if (!existing && places.size >= 100) return fail('The pilot has 100 saved places. Remove one before saving another.')
      if (!existing) places.set(id, { id, label: parsed.label, url: parsed.url, dedupeKey: key, createdAt: Date.now(), source: { senderId: context.senderId, name: context.name } })
      if (existing && validLocation(locations.get(id))) return { reply: 'That map link already has a saved location.', changed: false, placeId: id, widgetId }
      return { reply: `${existing ? 'Already saved' : 'Saved'} map link. Location unknown. To save a pin, send @Wanda place with the place name and city.`, changed: !existing, placeId: id, widgetId }
    }
    if (parsed.action === 'locate' && !places.has(parsed.placeId)) return fail('I couldn’t find that saved place ID. Check @Wanda places.')
    const coordinates = parsed.coordinates
    const query = parsed.action === 'name' ? parsed.value : parsed.action === 'locate' ? `Location for ${parsed.placeId}: ${coordinates.lat},${coordinates.lon}` : parsed.url
    const label = parsed.action === 'locate' ? displayName(doc, parsed.placeId, places.get(parsed.placeId)) : parsed.label
    const candidates = coordinates ? [{ ...coordinates, label, provider: 'supplied-coordinates' }] : null
    const result = pendingRecord(doc, context, query, candidates, parsed.placeId, parsed.action === 'url' ? parsed.url : undefined)
    if (result.error) return fail(result.error)
    const pending = result.record
    if (result.existing && pending.status === 'awaiting_confirmation') return { reply: choiceReply(pending), changed: false, pendingId: pending.id, widgetId }
    if (!coordinates && (!result.existing || pending.status === 'lookup_pending')) {
      // One lookup and final reply per originating request; a repeated request gets a short status.
      if (result.existing) return fail('That place is still being looked up. Please wait for the confirmation choices.')
      doc.getMap('pilotPlaceLookups').set(context.messageId, { state: 'pending', pendingId: pending.id, chatId: config.chatId })
      return { reply: `Looking up ${query}.`, deferReply: true, changed: true, pendingId: pending.id, widgetId }
    }
    return { reply: choiceReply(pending), changed: true, pendingId: pending.id, widgetId }
  } })
  const lookup = createGeocoder({ config, room: feature.room, persistNow, fetchImpl: options.geocodeFetch })
  function resumeLookups() {
    if (closed || running) return
    running = (async () => {
      while (!closed) {
        let r = feature.room(); if (!feature.usable(r)) break
        const jobs = r.doc.getMap('pilotPlaceLookups'), entry = [...jobs].find(([, job]) => job.state === 'pending' && job.chatId === config.chatId)
        if (!entry) break
        const [messageId, work] = entry, pending = r.doc.getMap('pendingPlaces').get(work.pendingId)
        jobs.set(messageId, { ...work, state: 'running' })
        if (!persistNow(r)) { jobs.set(messageId, work); break }
        let candidates = [], reason
        if (!pending || pending.expiresAt <= Date.now()) reason = 'expired'
        else try { candidates = await lookup(pending.query, abort.signal) } catch (error) { reason = ['geocoder_disabled', 'geocoder_daily_limit'].includes(error?.message) ? error.message : 'geocoder_unavailable' }
        if (closed) break
        r = feature.room(); if (!feature.usable(r)) break
        r.doc.transact(() => {
          const current = r.doc.getMap('pendingPlaces').get(work.pendingId)
          const expired = !current || current.expiresAt <= Date.now()
          const next = current && { ...current, candidates, status: expired ? 'expired' : candidates.length ? 'awaiting_confirmation' : 'unresolved', reason }
          if (next) r.doc.getMap('pendingPlaces').set(next.id, next)
          const reply = expired ? 'That place request expired. Send @Wanda place with the name again.' : reason ? `${reason === 'geocoder_disabled' ? 'Place lookup is disabled' : reason === 'geocoder_daily_limit' ? 'The daily lookup limit is reached' : 'Place lookup is unavailable'}. Your request is pending. ${reason === 'geocoder_disabled' ? 'Ask the operator to enable lookups.' : reason === 'geocoder_daily_limit' ? 'Try after the daily limit resets.' : 'Try the place name again later.'}` : choiceReply(next)
          jobs.set(messageId, { ...work, state: 'done' })
          const receipts = r.doc.getMap('pilotMessageReceipts'), receipt = receipts.get(messageId)
          if (receipt) receipts.set(messageId, { ...receipt, outcome: { ...receipt.outcome, reply, deferReply: false } })
          feature.recordReply(r.doc, messageId, reply)
        })
        persistNow(r); feature.resume()
      }
    })().finally(() => { running = null })
  }
  const bridge = createMapLinkBridge({ room: feature.room, persistNow, chatId: config.chatId, authorizedSenderId: config.authorizedSenderId, allowedSenders: new Set(config.testers.map((handle) => zeroSettleSenderId(normalizeHandle(handle)))) })
  return { command: feature.command, selection, observe: bridge.observe, split: bridge.resolve, setFallback: bridge.setFallback, resume: () => { bridge.resume(); feature.resume(); resumeLookups() }, close: () => { bridge.close(); closed = true; abort.abort(); feature.close() } }
}
