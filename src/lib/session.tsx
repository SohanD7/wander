import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/** Mocked auth (per requirements): no backend. One session per browser TAB, so two tabs = two people. */
export type Tone = 'sunset' | 'sea' | 'ink' | 'sun'

export interface Session {
  id: string
  name: string
  email?: string
  guest: boolean
  tone: Tone
}

const KEY = 'wander.session.v1'
const LAST_NAME_KEY = 'wander.lastName'
/** mock 'accounts': lowercased name → account id, so signing back in with a name restores its trips */
const ACCOUNTS_KEY = 'wander.accounts.v1'
const TONES: Tone[] = ['sunset', 'sea', 'ink', 'sun']

export const newId = (prefix = '') =>
  prefix + (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 10)

export function toneFor(id: string): Tone {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return TONES[h % TONES.length]
}

function readAccounts(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function read(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export const lastName = () => {
  try {
    return localStorage.getItem(LAST_NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

interface Ctx {
  session: Session | null
  /** `fresh` = sign up: always a brand-new account, so it starts with no trips */
  signIn: (input: { name: string; email?: string; guest?: boolean; fresh?: boolean }) => Session
  signOut: () => void
}

const SessionCtx = createContext<Ctx | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(read)

  const signIn = useCallback<Ctx['signIn']>(({ name, email, guest = false, fresh = false }) => {
    const accounts = readAccounts()
    const handle = (name.trim() || 'friend').toLowerCase()
    const id = guest ? (read()?.id ?? newId('u_')) : fresh ? newId('u_') : (accounts[handle] ?? read()?.id ?? newId('u_'))
    const next: Session = { id, name: name.trim() || 'friend', email, guest, tone: toneFor(id) }
    try {
      sessionStorage.setItem(KEY, JSON.stringify(next))
      localStorage.setItem(LAST_NAME_KEY, next.name)
      if (!guest) localStorage.setItem(ACCOUNTS_KEY, JSON.stringify({ ...accounts, [handle]: id }))
    } catch {
      /* storage blocked — session lives in memory only */
    }
    setSession(next)
    return next
  }, [])

  const signOut = useCallback(() => {
    try {
      sessionStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
    setSession(null)
  }, [])

  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut])
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

export function useSession() {
  const ctx = useContext(SessionCtx)
  if (!ctx) throw new Error('useSession outside SessionProvider')
  return ctx
}
