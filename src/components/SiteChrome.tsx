import { useTranslation } from 'react-i18next'
import { routes } from '../lib/router'
import { TopActions } from './TopActions'
import './SiteChrome.css'

export function SiteChrome({ active, showBrand = false }: { active?: 'home' | 'shelf' | 'notes'; showBrand?: boolean }) {
  const { t } = useTranslation()
  return (
    <header className={`site-chrome${showBrand ? ' site-chrome-home' : ''}`}>
      {showBrand && <span className="site-brand">Paper Reader</span>}
      <nav className="site-links">
        <a href={routes.home} className={active === 'home' ? 'active' : undefined}>{t('nav.home')}</a>
        <a href={routes.shelf} className={active === 'shelf' ? 'active' : undefined}>{t('nav.shelf')}</a>
        <a href={routes.notes} className={active === 'notes' ? 'active' : undefined}>{t('nav.notes')}</a>
      </nav>
      <div className="site-actions">
        <TopActions />
      </div>
    </header>
  )
}
