/** Dotted route line beside a day's stops. Parametric (stop count), not a stretched Figma raster. */
export function RouteTrack({ count }: { count: number }) {
  const rows = Math.max(count, 1)
  return (
    <div aria-hidden className="relative w-3 shrink-0">
      <div className="absolute inset-y-4 left-1/2 w-0 -translate-x-1/2 border-l-2 border-dashed border-sea/60" />
      {Array.from({ length: rows }, (_, i) => (
        <span
          key={i}
          className="absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-sea bg-cream"
          style={{ top: `calc(${(i + 0.5) / rows} * 100% - 5px)` }}
        />
      ))}
    </div>
  )
}
