import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LANGS } from '../i18n'
import { useAppearance } from '../lib/appearance'
import { displayName, useAuth } from '../lib/auth'
import './TopActions.css'

export function TopActions({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const { t, i18n } = useTranslation()
  const { user, error, signIn, signOut, clearError } = useAuth()
  const { mode, setAppearance } = useAppearance()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = LANGS.find((code) => i18n.language.toLowerCase().startsWith(code)) ?? 'en'
  const next = LANGS[(LANGS.indexOf(current) + 1) % LANGS.length]
  const short: Record<(typeof LANGS)[number], string> = { zh: '中', en: 'EN', ko: '한', es: 'ES' }
  const name = user ? displayName(user) || t('auth.friend') : ''

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`top-actions tone-${tone}`} ref={rootRef}>
      <button
        type="button"
        className="icon-button"
        aria-label={mode === 'day' ? t('appearance.toNight') : t('appearance.toDay')}
        onClick={() => setAppearance(mode === 'day' ? 'night' : 'day')}
      >
        {mode === 'day' ? <MoonIcon /> : <SunIcon />}
      </button>
      <button
        type="button"
        className="lang-switch"
        aria-label={t('lang.switch', { name: t(`lang.${next}`) })}
        onClick={() => void i18n.changeLanguage(next)}
      >
        {short[next]}
      </button>
      {user ? (
        <button type="button" className="login-button" onClick={() => setOpen((value) => !value)}>
          {t('auth.greeting', { name })}
        </button>
      ) : (
        <button
          type="button"
          className="login-button"
          onClick={() => {
            clearError()
            void signIn()
          }}
        >
          {t('auth.login')}
        </button>
      )}
      {user && open && (
        <div className="account-menu">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              void signOut()
            }}
          >
            {t('auth.logout')}
          </button>
        </div>
      )}
      {error && <p className="auth-error">{error}</p>}
    </div>
  )
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M21 14.5A8.5 8.5 0 0 1 9.5 3a7 7 0 1 0 11.5 11.5z" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M18.9 5.1l-1.6 1.6M6.7 17.3l-1.6 1.6" />
      </g>
    </svg>
  )
}
