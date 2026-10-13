import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SiteChrome } from '../components/SiteChrome'
import { LIBRARY_EVENT } from '../lib/changes'
import { countAnnotationsByKind, getReadingSeconds, listBooks, listTags } from '../lib/db'
import { currentChapter, importStatusText, progressPercent, useImportPdf } from '../lib/library'
import { routes } from '../lib/router'
import { useNarrow } from '../lib/useNarrow'
import { currentWeek, dayKey, formatLastRead } from '../lib/time'
import type { AnnotationKind, Book, Tag } from '../lib/types'
import './HomePage.css'

type WeekDay = { key: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'; minutes: number; isToday: boolean; isFuture: boolean }

const WEEK_KEYS: WeekDay['key'][] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

type HomeData = {
  book: Book | null
  tags: Tag[]
  week: WeekDay[]
  counts: Record<AnnotationKind, number>
}

async function loadHomeData(): Promise<HomeData> {
  const days = currentWeek()
  const [books, tags, counts, seconds] = await Promise.all([
    listBooks(),
    listTags(),
    countAnnotationsByKind(),
    getReadingSeconds(days.map(dayKey)),
  ])
  const today = dayKey(new Date())
  return {
    book: books[0] ?? null,
    tags,
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
  const [data, setData] = useState<HomeData | null>(null)
  const { state: importState, importFile } = useImportPdf()
  const inputRef = useRef<HTMLInputElement>(null)
  const showEyebrow = i18n.language.startsWith('zh')
  const phone = useNarrow(767)
  const compact = useNarrow(1023) && !phone

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
  const description = book ? '' : t('home.startDescription')
  const bookTags = book ? (data?.tags ?? []).filter((tag) => book.tagIds?.includes(tag.id)) : []

  return (
    <div className="home">
      <SiteChrome active="home" />
      <section className="home-hero">
        <div className="hero-main">
          {compact && <HeroProgress label={t('home.progress')} percent={percent} />}
          <p className="hero-status">
            <span className="status-dot" />
            {book ? t('home.reading', { page: book.currentPage, total: book.numPages }) : t('home.nothing')}
          </p>
          <h1 className={`hero-title${titleSize(title)}`}>{title}</h1>
          {bookTags.length > 0 && (
            <p className="hero-tags">
              {bookTags.map((tag) => (
                <span key={tag.id} className="hero-tag">
                  <span className={`tag-dot ${tag.color}`} />
                  {tag.name}
                </span>
              ))}
            </p>
          )}
          {book && <p className="hero-file">{book.fileName}</p>}
          {book?.author ? <p className="hero-author">{book.author}</p> : null}
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
          {compact && <NotesStats counts={data?.counts} showEyebrow={showEyebrow} placement="hero" />}
        </div>

        <footer className="hero-footer">
          {book?.needsFile && <span className="file-missing">{t('fileMissing.lead')}</span>}
          {book?.lastReadAt && !book.needsFile ? t('home.lastRead', { time: formatLastRead(book.lastReadAt) }) : null}
          <HintText text={book ? t('home.savedAccount') : t('home.localOnly')} english={!i18n.language.startsWith('zh')} />
        </footer>
      </section>

      {!compact && (
      <section className="home-cards">
        {phone ? (
          <article className="card card-progress-line">
            <header className="progress-line-head">
              <span className="card-label">{t('home.progress')}</span>
              <span className="progress-line-percent">{percent}%</span>
            </header>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${percent}%` }} />
            </div>
          </article>
        ) : (
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
        )}

        {phone ? (
          <article className="card card-week-line">
            <header className="card-head">
              <span className="card-label">{t('home.week')}</span>
              {showEyebrow && <span className="week-pill">Weekly tracker</span>}
            </header>
            <WeekLine week={week} />
          </article>
        ) : (
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
                    <div className="week-bar" style={{ height: `${(day.minutes / weekMax) * 100}%` }} />
                  </div>
                  <span className="week-label">{t(`week.${day.key}`)}</span>
                </div>
              ))}
            </div>
          </article>
        )}

        <NotesStats counts={data?.counts} showEyebrow={showEyebrow} placement="card" />
      </section>
      )}
    </div>
  )
}

function HintText({ text, english }: { text: string; english: boolean }) {
  if (!english) return <span className="hero-footer-note">{text}</span>
  const lines = text.split(/(?<=\.)\s+/).filter(Boolean)
  return (
    <span className="hero-footer-note">
      {lines.map((line) => (
        <span className="hero-footer-line" key={line}>{line}</span>
      ))}
    </span>
  )
}

function HeroProgress({ label, percent }: { label: string; percent: number }) {
  const value = Math.min(100, Math.max(0, percent))
  return (
    <div className="hero-progress">
      <span className="card-label">{label}</span>
      <div className="scrub">
        <div className="scrub-track">
          <div className="scrub-fill" style={{ width: `${value}%` }} />
          <div className="scrub-knob" style={{ left: `${value}%` }}>
            <span className="scrub-bubble">{value}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function WeekLine({ week }: { week: WeekDay[] }) {
  const { t } = useTranslation()
  const width = 280
  const height = 112
  const padX = 12
  const padY = 10
  const max = Math.max(...week.map((day) => day.minutes), 1)
  const points = week.map((day, index) => {
    const x = padX + (index * (width - padX * 2)) / Math.max(week.length - 1, 1)
    const y = height - padY - (day.minutes / max) * (height - padY * 2)
    return { x, y, day }
  })
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ')
  return (
    <div className="week-line">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        {[0.28, 0.52, 0.76].map((row) => (
          <line key={row} className="week-grid" x1="0" x2={width} y1={height * row} y2={height * row} />
        ))}
        <path className="week-stroke" d={path} />
        {points.map((point) => (
          <circle key={point.day.key} className="week-dot" cx={point.x} cy={point.y} r="3.5" />
        ))}
      </svg>
      <div className="week-line-labels">
        {week.map((day) => (
          <span key={day.key} title={t('home.weekTitle', { day: t(`week.${day.key}`), minutes: day.minutes })}>
            {t(`week.${day.key}`)}
          </span>
        ))}
      </div>
    </div>
  )
}

function NotesStats({
  counts,
  showEyebrow,
  placement,
}: {
  counts?: Record<AnnotationKind, number>
  showEyebrow: boolean
  placement: 'hero' | 'card'
}) {
  const { t } = useTranslation()
  return (
    <article className={placement === 'hero' ? 'hero-notes' : 'card'}>
      <header className="card-head">
        <span className="card-label">{t('home.notes')}</span>
        {showEyebrow && <span className={placement === 'hero' ? 'week-pill' : 'card-label'}>Notes</span>}
      </header>
      <div className="stats">
        {STAT_KINDS.map((kind) => (
          <div className="stat" key={kind}>
            <span className="stat-number">{counts?.[kind] ?? 0}</span>
            <span className="stat-label">
              <span className={`stat-dot ${kind}`} />
              {t(`home.${kind}`)}
            </span>
          </div>
        ))}
      </div>
    </article>
  )
}
