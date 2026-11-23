export const OSM_ATTRIBUTION = '© OpenStreetMap contributors · ODbL'
export const normalizePlaceName = (text) => text.trim().replace(/\s+/gu, ' ').toLowerCase()
export const validLocation = (value) => !!value && typeof value.lat === 'number' && typeof value.lon === 'number' && Number.isFinite(value.lat) && Number.isFinite(value.lon) && Math.abs(value.lat) <= 90 && Math.abs(value.lon) <= 180
export function parseCoordinates(text) {
  if (typeof text !== 'string' || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s*,\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text.trim())) return null
  const [lat, lon] = text.split(',').map(Number)
  return validLocation({ lat, lon }) ? { lat, lon } : null
}
export function parseMapLink(text) {
  let url
  try { url = new URL(text) } catch { return { error: 'Please send a valid HTTPS Google Maps link, or a place name.' } }
  const host = url.hostname.toLowerCase()
  const accepted = (['www.google.com', 'google.com'].includes(host) && /^\/maps(?:\/|$)/.test(url.pathname)) || host === 'maps.google.com' || host === 'maps.app.goo.gl' || (host === 'goo.gl' && url.pathname.startsWith('/maps/'))
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !accepted || text.length > 2000) return { error: 'Please use an HTTPS Google Maps link, without login details or a custom port.' }
  let coordinates = null
  // Documented Maps URLs search query coordinates denote a pin, not a camera center.
  if (['www.google.com', 'google.com'].includes(host) && /^\/maps\/search\/?$/.test(url.pathname) && url.searchParams.get('api') === '1' && !url.searchParams.has('query_place_id') && url.searchParams.getAll('query').length === 1) {
    const query = url.searchParams.get('query')
    coordinates = parseCoordinates(query)
    if (!coordinates && /^[\s+\-\d.,]+$/.test(query)) return { error: 'Those coordinates are invalid. Latitude must be −90 to 90 and longitude −180 to 180.' }
  }
  return { url: url.href, label: 'Google Maps link', coordinates }
}
export function savedPlaceRows(places, labels, locations) {
  return Object.entries(places).map(([id, place]) => ({ ...place, id, label: labels[id] ?? place.label, location: locations[id] ?? null }))
}

// Old cached/persisted Photon results contain only a comma-separated label.
export function placeName(candidate) { return candidate.name || candidate.label?.split(',')[0]?.trim() || 'Saved location' }
export function placeChoice(candidate) { return placeName(candidate) + (candidate.city ? ` — ${candidate.city}` : '') }
