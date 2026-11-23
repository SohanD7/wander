import { useEffect, useState } from 'react'
import type { Location } from '../../collab/pilot-places.mjs'

export function LocationMap({ label, location }: { label: string; location: Location }) {
  const [state, setState] = useState('loading')
  const source = `https://maps.google.com/maps?q=${encodeURIComponent(`${location.lat},${location.lon}`)}&z=15&output=embed`
  useEffect(() => {
    const timer = setTimeout(() => setState((s) => (s === 'loading' ? 'unavailable' : s)), 12000)
    return () => clearTimeout(timer)
  }, [source])
  return (
    <div className="shrink-0 space-y-1" aria-label={`Map for ${label}`}>
      <p role="status" className="text-xs">
        {state === 'loading'
          ? `Loading map for ${label}…`
          : state === 'unavailable'
            ? `Map preview unavailable for ${label}. Use Open location above.`
            : `${label} · Map preview. If blank, use Open location above.`}
      </p>
      <iframe
        title={`saved pin ${label}`}
        className="h-36 w-full rounded-2xl border-0"
        src={source}
        onLoad={() => setState('loaded')}
        onError={() => setState('unavailable')}
      />
    </div>
  )
}
