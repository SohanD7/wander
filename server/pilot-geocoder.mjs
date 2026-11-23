import crypto from 'node:crypto'
import { validLocation, normalizePlaceName, OSM_ATTRIBUTION } from '../src/collab/pilot-places.mjs'
export async function boundedJson(response, maxBytes = 65536) {
  if (!response.ok) throw Error('geocoder_unavailable')
  const reader = response.body.getReader(), chunks = []; let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      total += value.byteLength
      if (total > maxBytes) { await reader.cancel(); throw Error('geocoder_response_too_large') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export function createGeocoder({ config, room, persistNow, fetchImpl = fetch }) {
  const endpoint = new URL(config.geocoderUrl ?? 'https://photon.komoot.io/api')
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw Error('Geocoder requires an HTTPS endpoint without credentials, query or fragment')
  const interval = Math.max(1000, Math.min(60000, Number(config.geocoderIntervalMs) || 1100))
  const dailyLimit = Math.max(1, Math.min(100, Number(config.geocoderDailyLimit) || 50))
  return async (query, signal) => {
    if (!config.geocoderEnabled) throw Error('geocoder_disabled')
    const r = room(), cache = r.doc.getMap('pilotGeocoderCache'), meta = r.doc.getMap('pilotGeocoderMeta')
    const key = crypto.createHash('sha256').update(endpoint.href + normalizePlaceName(query)).digest('hex'), cached = cache.get(key)
    if (cached?.expiresAt > Date.now()) return cached.candidates
    const wait = Math.max(0, Number(meta.get('lastRequestAt') ?? 0) + interval - Date.now())
    if (wait) await new Promise((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(Error('aborted')) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, wait)
      signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
    })
    const day = new Date().toISOString().slice(0, 10), count = meta.get('day') === day ? Number(meta.get('count') ?? 0) : 0
    if (count >= dailyLimit) throw Error('geocoder_daily_limit')
    r.doc.transact(() => { meta.set('lastRequestAt', Date.now()); meta.set('day', day); meta.set('count', count + 1) })
    if (!persistNow(r)) throw Error('geocoder_storage')
    const url = new URL(endpoint); url.search = new URLSearchParams({ q: query, limit: '3', lang: 'en' })
    const response = await fetchImpl(url.href, { headers: { 'User-Agent': config.geocoderUserAgent || 'WanderPilot/1.0 (small, user-triggered trip pilot)', Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) })
    const data = await boundedJson(response)
    if (!Array.isArray(data.features)) throw Error('geocoder_invalid_response')
    const seen = new Set(), candidates = []
    for (const feature of data.features.slice(0, 3)) {
      const [lon, lat] = feature.geometry?.coordinates ?? [], p = feature.properties ?? {}
      if (feature.geometry?.type !== 'Point' || typeof lon !== 'number' || typeof lat !== 'number' || !validLocation({ lat, lon }) || typeof p.name !== 'string') continue
      const label = [...new Set([p.name, p.housenumber, p.street, p.city, p.state, p.country].filter((v) => typeof v === 'string' && v.trim()))].join(', ').replace(/\s+/gu, ' ').slice(0, 240)
      const providerId = typeof p.osm_type === 'string' && /^[NWR]$/i.test(p.osm_type) && /^\d+$/.test(String(p.osm_id)) ? `osm:${p.osm_type.toUpperCase()}:${p.osm_id}` : `point:${lat},${lon}:${normalizePlaceName(label)}`
      if (!seen.has(providerId)) { candidates.push({ label, name: p.name.trim().slice(0, 150), city: typeof p.city === 'string' ? p.city.trim().slice(0, 100) : '', lat, lon, provider: 'photon', providerId, attribution: OSM_ATTRIBUTION }); seen.add(providerId) }
    }
    const live = room(), liveCache = live.doc.getMap('pilotGeocoderCache')
    liveCache.set(key, { candidates, expiresAt: Date.now() + 7 * 86400000 })
    while (liveCache.size > 200) liveCache.delete(liveCache.keys().next().value)
    if (!persistNow(live)) throw Error('geocoder_storage')
    return candidates
  }
}
