import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { displayName, useAuth } from '../lib/auth'
import './TopActions.css'

export function TopActions({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const { t, i18n } = useTranslation()
  const { user, error, signIn, signOut, clearError } = useAuth()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const lang = i18n.language.startsWith('zh') ? 'zh' : 'en'
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
      <div className="lang-toggle" role="group" aria-label={lang === 'zh' ? '中 / EN' : '中 / EN'}>
        <button type="button" className={lang === 'zh' ? 'on' : undefined} onClick={() => void i18n.changeLanguage('zh')}>
          中
        </button>
        <span aria-hidden="true">/</span>
        <button type="button" className={lang === 'en' ? 'on' : undefined} onClick={() => void i18n.changeLanguage('en')}>
          EN
        </button>
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
