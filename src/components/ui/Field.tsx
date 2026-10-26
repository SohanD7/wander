import type { InputHTMLAttributes, ReactNode } from 'react'

export function Field({ label, hint, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode }) {
  return (
    <label className="block text-left">
      <span className="mb-1.5 block text-sm font-medium lowercase text-ink/70">{label}</span>
      <input
        {...rest}
        className={`h-12 w-full rounded-pill border-2 border-ink/15 bg-white px-5 text-base text-ink placeholder:text-ink/35 focus:border-sea ${className}`}
      />
      {hint && <span className="mt-1 block text-xs text-ink/55">{hint}</span>}
    </label>
  )
}
