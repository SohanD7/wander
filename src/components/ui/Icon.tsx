import { figmaIcons, type FigmaIcon, type IconName } from '../../icons/figmaIcons'

interface IconProps {
  name: IconName
  /** rendered px size; defaults to the native Figma frame size */
  size?: number
  className?: string
}

/** Renders a Figma-exported icon. Color comes from CSS `color` (stroke = currentColor). */
export function Icon({ name, size, className }: IconProps) {
  const icon = figmaIcons[name] as FigmaIcon
  const px = size ?? icon.size
  return (
    <svg
      width={px}
      height={px}
      viewBox={`0 0 ${icon.size} ${icon.size}`}
      fill="none"
      aria-hidden="true"
      className={`shrink-0 ${className ?? ''}`}
    >
      {icon.d.map((d, i) => (
        <path
          key={i}
          d={d}
          stroke="currentColor"
          strokeWidth={icon.sw}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={icon.dash?.[i]}
        />
      ))}
    </svg>
  )
}
