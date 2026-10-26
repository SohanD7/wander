import wordmarkUrl from '../../assets/brand/wordmark.png'
import logoUrl from '../../assets/brand/logo-lockup.png'
import { Pin } from './Pin'

/**
 * Brand art exported from Figma into src/assets/brand/:
 *   wordmark.png (75:6), logo-lockup.png (79:4 — pin + wordmark), pin.png (52:107 / 75:8).
 * Re-export from Figma and overwrite these files to update the brand everywhere.
 */
export function Wordmark({ height = 32, className = '' }: { height?: number; className?: string }) {
  return <img src={wordmarkUrl} alt="wander" height={height} style={{ height }} draggable={false} className={className} />
}

/** Pin + wordmark lockup (Figma `logo`) — nav bars, auth and onboarding headers. */
export function Logo({ height = 40, className = '' }: { height?: number; className?: string }) {
  return <img src={logoUrl} alt="wander" height={height} style={{ height }} draggable={false} className={className} />
}

/** Large mascot (Figma `wander-sprite-right`). `size` is the rendered height. */
export function Sprite({ size = 96, className = '' }: { size?: number; className?: string }) {
  return <Pin size={size} className={className} />
}
