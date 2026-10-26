import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'sea' | 'ghost' | 'cream'
const variants: Record<Variant, string> = {
  primary: 'bg-sunset text-cream hover:brightness-105',
  sea: 'bg-sea text-cream hover:brightness-105',
  cream: 'bg-cream text-ink hover:bg-white',
  ghost: 'bg-transparent text-ink border-2 border-ink/20 hover:border-ink/50',
}

export function Button({
  variant = 'primary',
  small,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean }) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-pill font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        small ? 'h-9 px-4 text-sm' : 'h-12 px-6 text-base'
      } ${variants[variant]} ${className}`}
    />
  )
}
