import { useTranslation } from 'react-i18next'
import { routes } from '../lib/router'
import { TopActions } from './TopActions'

export function SiteBar({ active }: { active: 'home' | 'shelf' | 'notes' }) {
  const { t } = useTranslation()
  return (
    <header className="shelf-bar">
      <div className="shelf-bar-top">
        <a className="site-brand" href={routes.home}>Paper Reader</a>
        <TopActions />
      </div>
      <nav className="shelf-links">
        <a href={routes.home} className={active === 'home' ? 'active' : undefined}>{t('nav.home')}</a>
        <a href={routes.shelf} className={active === 'shelf' ? 'active' : undefined}>{t('nav.shelf')}</a>
        <a href={routes.notes} className={active === 'notes' ? 'active' : undefined}>{t('nav.notes')}</a>
      </nav>
    </header>
  )
}
