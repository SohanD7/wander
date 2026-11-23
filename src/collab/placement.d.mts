import type { Widget } from './types'
export const GRID: number
export function snap(n: number): number
export function footprint(w: Partial<Widget> & { x: number; y: number }): { x: number; y: number; w: number; h: number }
export function placeWidget(widgets: Iterable<Widget>, incoming?: Partial<Widget>): { x: number; y: number }
