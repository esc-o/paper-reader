import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import i18n from '../i18n'
import { onLocalChange } from './changes'
import { supabase } from './supabase'
import { syncNow } from './sync'

type AuthValue = {
  configured: boolean
  user: User | null
  error: string | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  clearError: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function displayName(user: User): string {
  const meta = user.user_metadata as { full_name?: string; name?: string }
  return meta.full_name || meta.name || user.email?.split('@')[0] || ''
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setSession(data.session)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (!userId) return
    void syncNow()
    let timer = 0
    const stop = onLocalChange(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void syncNow(), 800)
    })
    return () => {
      window.clearTimeout(timer)
      stop()
    }
  }, [userId])

  const signIn = useCallback(async () => {
    if (!supabase) {
      setError(i18n.t('auth.needsSetup'))
      return
    }
    setError(null)
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${window.location.pathname}` },
    })
    if (authError) setError(authError.message || i18n.t('auth.failed'))
  }, [])

  const signOut = useCallback(async () => {
    setError(null)
    if (!supabase) return
    const { error: authError } = await supabase.auth.signOut()
    if (authError) setError(authError.message || i18n.t('auth.failed'))
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const value = useMemo<AuthValue>(
    () => ({
      configured: supabase !== null,
      user: session?.user ?? null,
      error,
      signIn,
      signOut,
      clearError,
    }),
    [session, error, signIn, signOut, clearError],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider is missing')
  return value
}
