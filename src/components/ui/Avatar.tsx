import type { Tone } from '../../lib/session'

const tones: Record<Tone, string> = {
  sunset: 'bg-sunset text-cream',
  sea: 'bg-sea text-cream',
  ink: 'bg-ink text-cream',
  sun: 'bg-sun text-ink',
}

export function Avatar({ name, tone, size = 36, ring, className = '' }: { name: string; tone: Tone; size?: number; ring?: boolean; className?: string }) {
  return (
    <span
      title={name}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold uppercase ${tones[tone]} ${
        ring ? 'ring-2 ring-cream' : ''
      } ${className}`}
    >
      {name.trim().charAt(0) || '?'}
    </span>
  )
}

export const toneBg = (t: Tone) => ({ sunset: '#f37521', sea: '#57b1a8', ink: '#422f0e', sun: '#e0c24f' })[t]
