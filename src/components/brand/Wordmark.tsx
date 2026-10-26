import { useState } from 'react'

/**
 * Brand rasters (wordmark, sprite) are exported from Figma into /public/brand/.
 * Until they exist this falls back to typeset text so nothing renders broken.
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

/** Mascot/sprite slot — a simple pin placeholder if the Figma export isn't in place yet. */
export function Sprite({ size = 96, className = '' }: { size?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed)
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden>
        <path d="M24 44s14-12.2 14-23A14 14 0 0 0 10 21c0 10.8 14 23 14 23Z" fill="#f37521" />
        <circle cx="24" cy="21" r="6" fill="#fffaea" />
      </svg>
    )
  return <img src="/brand/wander-sprite.png" alt="" width={size} style={{ width: size }} onError={() => setFailed(true)} className={className} />
}
