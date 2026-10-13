import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TopActions } from '../components/TopActions'
import { useAuth } from '../lib/auth'
import { LIBRARY_EVENT } from '../lib/changes'
import { countAnnotationsByKind, getReadingSeconds, listBooks } from '../lib/db'
import { currentChapter, importStatusText, progressPercent, useImportPdf } from '../lib/library'
import { routes } from '../lib/router'
import { currentWeek, dayKey, formatLastRead } from '../lib/time'
import type { AnnotationKind, Book } from '../lib/types'
import './HomePage.css'

type WeekDay = { key: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'; minutes: number; isToday: boolean; isFuture: boolean }

const WEEK_KEYS: WeekDay['key'][] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

type HomeData = {
  book: Book | null
  week: WeekDay[]
  counts: Record<AnnotationKind, number>
}

async function loadHomeData(): Promise<HomeData> {
  const days = currentWeek()
  const [books, counts, seconds] = await Promise.all([
    listBooks(),
    countAnnotationsByKind(),
    getReadingSeconds(days.map(dayKey)),
  ])
  const today = dayKey(new Date())
  return {
    book: books[0] ?? null,
    counts,
    week: days.map((day, i) => ({
      key: WEEK_KEYS[i],
      minutes: Math.round(seconds[i] / 60),
      isToday: dayKey(day) === today,
      isFuture: dayKey(day) > today,
    })),
  }
}

function titleSize(title: string): string {
  if (title.length > 70) return ' long'
  if (title.length > 32) return ' medium'
  return ''
}

const STAT_KINDS: ('highlight' | 'underline' | 'comment')[] = ['highlight', 'underline', 'comment']

export function HomePage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [data, setData] = useState<HomeData | null>(null)
  const { state: importState, importFile } = useImportPdf()
  const inputRef = useRef<HTMLInputElement>(null)
  const showEyebrow = i18n.language.startsWith('zh')

  useEffect(() => {
    const load = () => loadHomeData().then(setData)
    load()
    window.addEventListener(LIBRARY_EVENT, load)
    return () => window.removeEventListener(LIBRARY_EVENT, load)
  }, [])

  const book = data?.book ?? null
  const percent = book ? progressPercent(book) : 0
  const chapter = book ? currentChapter(book) : ''
  const week = data?.week ?? []
  const weekTotal = week.reduce((sum, d) => sum + d.minutes, 0)
  const weekMax = Math.max(...week.map((d) => d.minutes), 1)
  const importStatus = importStatusText(importState)

  const title = book?.title ?? t('home.startTitle')
  const description = book ? book.description : t('home.startDescription')

  return (
    <div className="home">
      <section className="home-hero">
        <nav className="home-nav">
          <span className="home-brand">Paper Reader</span>
          <a href={routes.home} className="active">{t('nav.home')}</a>
          <a href={routes.shelf}>{t('nav.shelf')}</a>
          <a href={routes.notes}>{t('nav.notes')}</a>
          <div className="home-corner">
            <TopActions tone="light" />
          </div>
        </nav>

        <div className="hero-main">
          <p className="hero-status">
            <span className="status-dot" />
            {book ? t('home.reading', { page: book.currentPage, total: book.numPages }) : t('home.nothing')}
          </p>
          <h1 className={`hero-title${titleSize(title)}`}>{title}</h1>
          {book?.author && <p className="hero-author">{book.author}</p>}
          {description && <p className="hero-description">{description}</p>}
          <div className="hero-actions">
            {book?.needsFile ? (
              <a className="btn-cream" href={routes.reader(book.id)}>{t('shelf.reimport')}</a>
            ) : book ? (
              <a className="btn-cream" href={routes.reader(book.id)}>{t('home.continue')}</a>
            ) : (
              <button type="button" className="btn-cream" onClick={() => inputRef.current?.click()}>
                {t('home.import')}
              </button>
            )}
            <a className="btn-outline" href={routes.shelf}>{t('home.shelf')}</a>
          </div>
          {importStatus && (
            <p className={`hero-import${importState.kind === 'error' ? ' error' : ''}`}>{importStatus}</p>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) importFile(file)
              e.target.value = ''
            }}
          />
        </div>

        <footer className="hero-footer">
          {book?.needsFile
            ? t('home.reimport')
            : book?.lastReadAt
              ? t('home.lastRead', { time: formatLastRead(book.lastReadAt) })
              : null}
          <span className="hero-footer-note">{user ? t('home.savedAccount') : t('home.localOnly')}</span>
        </footer>
      </section>

      <section className="home-cards">
        <article className="card card-progress">
          <header className="card-head">
            <span className="card-label">{t('home.progress')}</span>
            {showEyebrow && <span className="card-label">Progress</span>}
          </header>
          <p className="card-number">{percent}%</p>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="card-sub">{chapter || (book ? t('home.noChapter') : t('home.nothing'))}</p>
        </article>

        <article className="card">
          <header className="card-head">
            <span className="card-label">{t('home.week')}</span>
            {showEyebrow && <span className="card-label">This week</span>}
          </header>
          <p className="card-number">
            {weekTotal}
            <span className="card-unit">{t('home.minutes')}</span>
          </p>
          <div className="week-chart">
            {week.map((day) => (
              <div className="week-day" key={day.key} title={t('home.weekTitle', { day: t(`week.${day.key}`), minutes: day.minutes })}>
                <div className="week-bar-area">
                  <div
                    className={`week-bar${day.isToday ? ' today' : ''}${day.isFuture ? ' future' : ''}`}
                    style={{ height: `${(day.minutes / weekMax) * 100}%` }}
                  />
                </div>
                <span className={`week-label${day.isToday ? ' today' : ''}`}>{t(`week.${day.key}`)}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <header className="card-head">
            <span className="card-label">{t('home.notes')}</span>
            {showEyebrow && <span className="card-label">Notes</span>}
          </header>
          <div className="stats">
            {STAT_KINDS.map((kind) => (
              <div className="stat" key={kind}>
                <span className="stat-number">{data?.counts[kind] ?? 0}</span>
                <span className="stat-label">
                  <span className={`stat-dot ${kind}`} />
                  {t(`home.${kind}`)}
                </span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  )
}
