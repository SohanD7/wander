/** Shared canvas geometry: the board's 12px grid, three columns, and default card width. */
export const GRID = 12
export const snap = (n) => Math.round(n / GRID) * GRID
export function footprint(w) {
  const natural = w.type === 'note' ? 252 : w.type === 'checklist' ? 204 + (w.items?.length ?? 0) * 48 + (w.source ? 36 : 0) : w.type === 'vote' ? 252 + (w.options?.length ?? 0) * 60 + (w.nativePoll ? 84 : 0) : 360
  return { x: w.x, y: w.y, w: w.w ?? 360, h: w.h ?? natural }
}
/** Fill the earliest free slot; never move existing cards. Relay transactions reserve slots immediately. */
export function placeWidget(widgets, incoming = { type: 'note' }) {
  const occupied = Array.from(widgets, footprint)
  const size = footprint({ x: 0, y: 0, ...incoming })
  const ys = [...new Set([snap(128), ...occupied.map((r) => Math.ceil((r.y + r.h + 24) / GRID) * GRID)])].filter((y) => y >= snap(128)).sort((a, b) => a - b)
  for (const y of ys) for (let col = 0; col < 3; col++) {
    const x = snap(176 + col * 396)
    if (occupied.every((r) => x + size.w + 24 <= r.x || x >= r.x + r.w + 24 || y + size.h + 24 <= r.y || y >= r.y + r.h + 24)) return { x, y }
  }
  // The candidate below the lowest occupied edge is always free.
  return { x: snap(176), y: Math.max(snap(128), ...ys) }
}
