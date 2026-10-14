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
  const [langOpen, setLangOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = LANGS.find((code) => i18n.language.toLowerCase().startsWith(code)) ?? 'en'
  const name = user ? displayName(user) || t('auth.friend') : ''

  useEffect(() => {
    if (!open && !langOpen) return
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
      setLangOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setLangOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, langOpen])

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
      <div className="lang-picker">
        <button
          type="button"
          className="icon-button lang-switch"
          aria-label={t('lang.choose')}
          aria-expanded={langOpen}
          onClick={() => {
            setOpen(false)
            setLangOpen((value) => !value)
          }}
        >
          <GlobeIcon />
        </button>
        {langOpen && (
          <div className="lang-menu" role="menu" aria-label={t('lang.choose')}>
            {LANGS.map((code) => (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={code === current}
                className={code === current ? 'on' : undefined}
                onClick={() => {
                  void i18n.changeLanguage(code)
                  setLangOpen(false)
                }}
              >
                {t(`lang.${code}`)}
              </button>
            ))}
          </div>
        )}
      </div>
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

function GlobeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M12 3.75c2.2 2.3 3.3 5.1 3.3 8.25S14.2 18 12 20.25C9.8 18 8.7 15.15 8.7 12S9.8 6.05 12 3.75zM4.2 12h15.6" />
    </svg>
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
