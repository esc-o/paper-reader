import { useEffect, useRef, useState } from 'react'
import { countAnnotationsByKind, getReadingSeconds, listBooks } from '../lib/db'
import { currentChapter, importStatusText, progressPercent, useImportPdf } from '../lib/library'
import { routes } from '../lib/router'
import { currentWeek, dayKey, formatLastRead, WEEKDAY_LABELS } from '../lib/time'
import type { AnnotationKind, Book } from '../lib/types'
import './HomePage.css'

type WeekDay = { label: string; minutes: number; isToday: boolean; isFuture: boolean }

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
      label: WEEKDAY_LABELS[i],
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

const STAT_LABELS: [AnnotationKind, string][] = [
  ['highlight', '高亮'],
  ['underline', '划线'],
  ['comment', '评论'],
]

export function HomePage() {
  const [data, setData] = useState<HomeData | null>(null)
  const { state: importState, importAndOpen } = useImportPdf()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadHomeData().then(setData)
  }, [])

  const book = data?.book ?? null
  const percent = book ? progressPercent(book) : 0
  const chapter = book ? currentChapter(book) : ''
  const week = data?.week ?? []
  const weekTotal = week.reduce((sum, d) => sum + d.minutes, 0)
  const weekMax = Math.max(...week.map((d) => d.minutes), 1)
  const importStatus = importStatusText(importState)

  const title = book?.title ?? '从一篇论文开始。'
  const description = book
    ? book.description
    : '把 PDF 拖进书架，自动按段落整理。读的时候可以高亮、划线、写评论，选中生词还能直接查词和翻译。'

  return (
    <div className="home">
      <section className="home-hero">
        <nav className="home-nav">
          <span className="home-brand">Paper Reader</span>
          <a href={routes.home} className="active">首页</a>
          <a href={routes.shelf}>书架</a>
        </nav>

        <div className="hero-main">
          <p className="hero-status">
            <span className="status-dot" />
            {book ? `正在阅读 · 第 ${book.currentPage} / ${book.numPages} 页` : '还没有在读的文献'}
          </p>
          <h1 className={`hero-title${titleSize(title)}`}>{title}</h1>
          {book?.author && <p className="hero-author">{book.author}</p>}
          {description && <p className="hero-description">{description}</p>}
          <div className="hero-actions">
            {book ? (
              <a className="btn-cream" href={routes.reader(book.id)}>继续阅读</a>
            ) : (
              <button type="button" className="btn-cream" onClick={() => inputRef.current?.click()}>
                导入 PDF
              </button>
            )}
            <a className="btn-outline" href={routes.shelf}>书架 →</a>
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
              if (file) importAndOpen(file)
              e.target.value = ''
            }}
          />
        </div>

        <footer className="hero-footer">
          {book?.lastReadAt ? `最近阅读 · ${formatLastRead(book.lastReadAt)}` : 'Paper Reader · 数据只存在本机'}
        </footer>
      </section>

      <section className="home-cards">
        <article className="card card-progress">
          <header className="card-head">
            <span className="card-label">阅读进度</span>
            <span className="card-label">Progress</span>
          </header>
          <p className="card-number">{percent}%</p>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="card-sub">{chapter || (book ? '还没读到带标题的章节' : '还没有在读的文献')}</p>
        </article>

        <article className="card">
          <header className="card-head">
            <span className="card-label">本周阅读</span>
            <span className="card-label">This week</span>
          </header>
          <p className="card-number">
            {weekTotal}
            <span className="card-unit">分钟</span>
          </p>
          <div className="week-chart">
            {week.map((day) => (
              <div className="week-day" key={day.label} title={`周${day.label}：${day.minutes} 分钟`}>
                <div className="week-bar-area">
                  <div
                    className={`week-bar${day.isToday ? ' today' : ''}${day.isFuture ? ' future' : ''}`}
                    style={{ height: `${(day.minutes / weekMax) * 100}%` }}
                  />
                </div>
                <span className={`week-label${day.isToday ? ' today' : ''}`}>{day.label}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <header className="card-head">
            <span className="card-label">标注统计</span>
            <span className="card-label">Notes</span>
          </header>
          <div className="stats">
            {STAT_LABELS.map(([kind, label]) => (
              <div className="stat" key={kind}>
                <span className="stat-number">{data?.counts[kind] ?? 0}</span>
                <span className="stat-label">
                  <span className={`stat-dot ${kind}`} />
                  {label}
                </span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  )
}
