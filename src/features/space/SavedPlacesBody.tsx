import { useEffect, useState } from 'react'
import { useTrip, useYMap } from '../../collab/TripProvider'
import { validLocation, parseMapLink, savedPlaceRows, placeChoice, type SavedPlace, type Location } from '../../collab/pilot-places.mjs'
import { LocationMap } from './LocationMap'
interface Pending { senderId: string; id: string; query: string; name: string; status: string; expiresAt: number; candidates: { label: string; name?: string; city?: string; provider?: string }[] }
export function SavedPlacesBody() {
  const { room } = useTrip()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  const members = useYMap(room.members)
  const places = useYMap(room.doc.getMap<SavedPlace>('savedPlaces')), labels = useYMap(room.doc.getMap<string>('savedPlaceLabels')), locations = useYMap(room.doc.getMap<Location>('placeLocations'))
  const pending = Object.values(useYMap(room.doc.getMap<Pending>('pendingPlaces'))).filter((p) => !['confirmed', 'expired'].includes(p.status) && p.expiresAt > now)
  const rows = savedPlaceRows(places, labels, locations), [selectedId, setSelectedId] = useState('')
  const hasPin = (p: SavedPlace) => validLocation(p.location)
  const selected = rows.find((p) => p.id === selectedId && hasPin(p)) ?? rows.find(hasPin)
  return <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto" data-saved-places>
    <h3 className="shrink-0 text-lg font-semibold">Saved places</h3>
    <div className="max-h-24 shrink-0 overflow-auto" aria-label="saved places collection">
      {!rows.length && <p className="text-sm text-ink/60">No saved places yet.</p>}
      {rows.map((p) => <div key={p.id} className="mb-2 rounded-xl bg-white/60 p-2 text-xs">
        <input aria-label={`place label ${p.id}`} className="w-full bg-transparent font-semibold" value={p.label} maxLength={200} onChange={(e) => room.doc.getMap('savedPlaceLabels').set(p.id, e.target.value)} />
        <p>{hasPin(p) ? 'Saved location' : p.url ? 'Location unknown · saved map link' : 'Location unavailable · request this place again'}</p>
        <p className="text-ink/60">Shared by {members[p.source?.senderId]?.name ?? p.source?.name ?? 'Trip tester'}</p>
        {p.url && !('error' in parseMapLink(p.url)) && <a className="underline" href={p.url} target="_blank" rel="noreferrer">Open saved map link</a>}
        {hasPin(p) && <><button type="button" className="ml-2 underline" onClick={() => setSelectedId(p.id)}>Show pin</button><a className="ml-2 underline" href={`https://www.google.com/maps/search/?api=1&query=${p.location!.lat},${p.location!.lon}`} target="_blank" rel="noreferrer">Open location</a></>}
        <button type="button" aria-label={`remove saved place ${p.id}`} className="ml-2 underline" onClick={() => room.doc.transact(() => { room.doc.getMap('savedPlaces').delete(p.id); room.doc.getMap('savedPlaceLabels').delete(p.id); room.doc.getMap('placeLocations').delete(p.id) })}>Remove</button>
      </div>)}
    </div>
    {selected?.location && validLocation(selected.location) ? <LocationMap key={`${selected.id}:${selected.location.lat},${selected.location.lon}`} label={selected.label} location={selected.location} /> : <p role="status" className="flex min-h-[70px] shrink-0 items-center rounded-2xl bg-white/60 p-2 text-sm">{pending.some((p) => p.status === 'lookup_pending') ? 'Looking up your place…' : pending.some((p) => p.status === 'awaiting_confirmation') ? 'Waiting for your place selection in iMessage.' : rows.length ? 'Saved links are ready to open. Add a place by name to save a pin.' : 'Send @Wanda place with a name and city to start.'}</p>}
    {pending.length > 0 && <details className="shrink-0 text-xs" aria-label="pending place confirmations"><summary className="cursor-pointer">{pending.length} pending {pending.length === 1 ? 'place' : 'places'}</summary><div className="max-h-24 overflow-auto">
      {pending.map((p) => <div key={p.id} className="mb-2"><b>{p.query.startsWith('https:') ? 'Map link' : p.query.startsWith('Location for sp_') ? 'Location confirmation' : p.query}</b> · {members[p.senderId]?.name ?? p.name}
        {p.status === 'unresolved' ? <p>Lookup unavailable or no match. Try the name and city again.</p> : p.candidates.map((candidate, index) => <p key={index}>{index + 1}. {placeChoice(candidate)}</p>)}
        {p.status === 'awaiting_confirmation' && <p>Reply to Wanda’s choices with a number, or use @Wanda choose 1 for your only active lookup.</p>}
      </div>)}
    </div></details>}
    {(pending.some((p) => p.candidates.some((c) => c.provider === 'photon')) || rows.some((p) => p.location?.provider === 'photon')) && <a className="shrink-0 text-xs underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL · via Photon</a>}
  </div>
}
