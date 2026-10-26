import { useState } from 'react'

/**
 * The Wander map-pin mascot (Figma: `progress-sprite` 52:107). Used as the logo mark, the progress
 * marker and the loading symbol. Loads the real Figma export from /public/brand/pin.png and falls
 * back to an equivalent drawn pin so nothing renders broken before the asset is dropped in.
 */
export function Pin({ size = 40, className = '', bob = false }: { size?: number; className?: string; bob?: boolean }) {
  const [failed, setFailed] = useState(false)
  const w = Math.round((size * 51) / 58)
  const cls = `${bob ? 'animate-pin-bob' : ''} ${className}`
  if (!failed)
    return <img src="/brand/pin.png" alt="" width={w} height={size} style={{ width: w, height: size }} onError={() => setFailed(true)} className={cls} draggable={false} />
  return (
    <svg width={w} height={size} viewBox="0 0 51 58" className={cls} aria-hidden>
      <path d="M25.5 56.5S4 38 4 22.5a21.5 21.5 0 0 1 43 0C47 38 25.5 56.5 25.5 56.5Z" className="fill-sunset" />
      <ellipse cx="25.5" cy="22.5" rx="14.5" ry="14" className="fill-cream" />
      <ellipse cx="20" cy="20" rx="2.1" ry="2.8" className="fill-ink" />
      <ellipse cx="31" cy="20" rx="2.1" ry="2.8" className="fill-ink" />
      <path d="M19.5 26.5c2.2 3.2 9.8 3.2 12 0" fill="none" strokeWidth="2.2" strokeLinecap="round" className="stroke-ink" />
      <circle cx="15.8" cy="25.5" r="2.2" className="fill-sunset/40" />
      <circle cx="35.2" cy="25.5" r="2.2" className="fill-sunset/40" />
    </svg>
  )
}

/** Loading / "thinking" indicator: the pin hops on a pulsing shadow. Use anywhere Wander is crawling or generating. */
export function PinLoader({ label, size = 64, className = '' }: { label?: string; size?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label ?? 'loading'} className={`flex flex-col items-center gap-2 ${className}`}>
      <div className="relative flex flex-col items-center" style={{ height: size * 1.35 }}>
        <Pin size={size} bob />
        <span className="animate-pin-shadow absolute bottom-0 h-2 rounded-full bg-ink/25" style={{ width: size * 0.5 }} />
      </div>
      {label && <p className="text-sm text-ink/70">{label}<span className="pin-dots" aria-hidden /></p>}
    </div>
  )
}

/** Progress track whose fill ends in the pin — as in the Figma onboarding / new-trip headers. */
export function PinProgress({ step, total, className = '' }: { step: number; total: number; className?: string }) {
  const pct = ((step + 1) / total) * 100
  return (
    <div className={`relative h-8 ${className}`} role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step + 1} aria-label={`step ${step + 1} of ${total}`}>
      <div className="absolute inset-x-0 bottom-1 h-1.5 rounded-full bg-ink/10" />
      <div className="absolute bottom-1 left-0 h-1.5 rounded-full bg-sunset transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      <div className="absolute bottom-0 -translate-x-1/2 transition-[left] duration-500 ease-out" style={{ left: `calc(${pct}% - ${pct / 100} * 12px + 6px)`, maxWidth: '100%' }}>
        <Pin size={28} />
      </div>
    </div>
  )
}
