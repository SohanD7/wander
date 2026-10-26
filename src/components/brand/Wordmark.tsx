import { useState } from 'react'
import { Pin } from './Pin'

/**
 * Brand rasters are exported from Figma into /public/brand/ (see docs/FIGMA_WORKFLOW.md):
 *   wordmark.png (75:6), logo-lockup.png (79:4), sprite.png (75:8), pin.png (52:107).
 * Until they exist these fall back to typeset text + the drawn pin so nothing renders broken.
 */
export function Wordmark({ height = 32, className = '' }: { height?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed)
    return (
      <span style={{ fontSize: height * 0.9, lineHeight: 1 }} className={`font-semibold lowercase tracking-tight text-ink ${className}`}>
        wander
      </span>
    )
  return <img src="/brand/wordmark.png" alt="wander" height={height} style={{ height }} onError={() => setFailed(true)} className={className} />
}

/** Pin + wordmark lockup (Figma `logo`, 79:4) — nav bars, auth and onboarding headers. */
export function Logo({ height = 40, className = '' }: { height?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed)
    return (
      <span className={`inline-flex items-center gap-2 ${className}`} aria-label="wander">
        <Pin size={height} />
        <Wordmark height={height * 0.8} />
      </span>
    )
  return <img src="/brand/logo-lockup.png" alt="wander" height={height} style={{ height }} onError={() => setFailed(true)} className={className} />
}

/** Large mascot (Figma `wander-sprite-right`, 75:8). */
export function Sprite({ size = 96, className = '' }: { size?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <Pin size={size * 1.15} className={className} />
  return <img src="/brand/sprite.png" alt="" width={size} style={{ width: size }} onError={() => setFailed(true)} className={className} draggable={false} />
}
