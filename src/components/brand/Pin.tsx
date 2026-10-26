import pinUrl from '../../assets/brand/pin.png'

/**
 * The Wander map-pin mascot with its teal trail dots (Figma `progress-sprite` / `wander-sprite`).
 * Exported brand art lives in src/assets/brand/ and is bundled (inlined in the preview build).
 * `size` is the rendered height; width follows the artwork's 360:527 ratio.
 */
export const PIN_RATIO = 360 / 527

export function Pin({ size = 40, className = '', bob = false }: { size?: number; className?: string; bob?: boolean }) {
  return (
    <img src={pinUrl} alt="" height={size} style={{ height: size, width: size * PIN_RATIO }} draggable={false}
      className={`${bob ? 'animate-pin-bob' : ''} ${className}`} />
  )
}

/** Loading / "thinking" indicator: the pin hops while Wander crawls or generates. */
export function PinLoader({ label, size = 88, className = '' }: { label?: string; size?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label ?? 'loading'} className={`flex flex-col items-center gap-3 ${className}`}>
      <Pin size={size} bob />
      {label && <p className="text-sm text-ink/70">{label}<span className="pin-dots" aria-hidden /></p>}
    </div>
  )
}

/** Progress track whose fill ends in the pin — as in the Figma onboarding / new-trip headers. */
export function PinProgress({ step, total, className = '' }: { step: number; total: number; className?: string }) {
  const pct = ((step + 1) / total) * 100
  const pinH = 36
  return (
    <div className={`relative ${className}`} style={{ height: pinH * 0.8 + 6 }} role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step + 1} aria-label={`step ${step + 1} of ${total}`}>
      <div className="absolute inset-x-0 bottom-0 h-1.5 rounded-full bg-ink/10" />
      <div className="absolute bottom-0 left-0 h-1.5 rounded-full bg-sunset transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      <div className="pointer-events-none absolute bottom-1 transition-[left] duration-500 ease-out" style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}>
        <Pin size={pinH} />
      </div>
    </div>
  )
}
