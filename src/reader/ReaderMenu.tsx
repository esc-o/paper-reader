import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useFonts } from '../lib/fonts'
import type { ReaderSettings, ReaderTheme } from '../lib/settings'
import { displayPage } from '../lib/toc'
import type { TocEntry } from '../lib/toc'
import type { Book } from '../lib/types'
import './ReaderMenu.css'

const FAB_SIZE = 52
const FAB_MARGIN = 16

type TocItem = { title: string; pdfPage: number; bookPage: number; level: number }

function defaultFab(): { x: number; y: number } {
  return {
    x: Math.max(FAB_MARGIN, window.innerWidth - FAB_SIZE - FAB_MARGIN),
    y: Math.max(FAB_MARGIN, window.innerHeight - FAB_SIZE - 28),
  }
}

function snap(x: number, y: number): { x: number; y: number } {
  const maxX = Math.max(FAB_MARGIN, window.innerWidth - FAB_SIZE - FAB_MARGIN)
  const maxY = Math.max(FAB_MARGIN, window.innerHeight - FAB_SIZE - FAB_MARGIN)
  return {
    x: x + FAB_SIZE / 2 < window.innerWidth / 2 ? FAB_MARGIN : maxX,
    y: Math.min(Math.max(FAB_MARGIN, y), maxY),
  }
}

export function ReadingFab({
  open,
  position,
  onPosition,
  onToggle,
}: {
  open: boolean
  position: ReaderSettings['fab']
  onPosition: (position: { x: number; y: number }) => void
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const [pos, setPos] = useState(() => position ?? defaultFab())
  const posRef = useRef(pos)
  const drag = useRef<{ dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null)

  useEffect(() => {
    const onResize = () => {
      const snapped = snap(posRef.current.x, posRef.current.y)
      posRef.current = snapped
      setPos(snapped)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    drag.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y, x: event.clientX, y: event.clientY, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current) return
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8) current.moved = true
    const maxX = window.innerWidth - FAB_SIZE
    const maxY = window.innerHeight - FAB_SIZE
    const next = {
      x: Math.min(Math.max(0, event.clientX - current.dx), maxX),
      y: Math.min(Math.max(0, event.clientY - current.dy), maxY),
    }
    posRef.current = next
    setPos(next)
  }

  function onPointerUp() {
    const current = drag.current
    drag.current = null
    if (!current) return
    if (!current.moved) {
      onToggle()
      return
    }
    const snapped = snap(posRef.current.x, posRef.current.y)
    posRef.current = snapped
    setPos(snapped)
    onPosition(snapped)
  }

  return createPortal(
    <button
      type="button"
      className={`reading-fab${open ? ' open' : ''}`}
      style={{ left: pos.x, top: pos.y }}
      aria-label={open ? t('menu.close') : t('menu.open')}
      aria-expanded={open}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {open ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 7h14M5 12h14M5 17h14" />
        </svg>
      )}
    </button>,
    document.body,
  )
}

function tocItems(book: Book): TocItem[] {
  const offset = book.pageOffset ?? 0
  if ((book.toc ?? []).length > 0) {
    return (book.toc as TocEntry[]).map((entry) => ({
      title: entry.title,
      pdfPage: entry.pdfPage,
      bookPage: entry.bookPage,
      level: entry.level,
    }))
  }
  return book.paragraphs
    .filter((paragraph) => paragraph.isHeading && !paragraph.isToc)
    .map((paragraph) => ({
      title: paragraph.text,
      pdfPage: paragraph.startPage,
      bookPage: displayPage(paragraph.startPage, offset),
      level: 1,
    }))
}

const THEME_IDS: ReaderTheme[] = ['day', 'sepia', 'night']

export function ReaderMenu({
  book,
  page,
  settings,
  onSettings,
  onJump,
  onExport,
  onClose,
}: {
  book: Book
  page: number
  settings: ReaderSettings
  onSettings: (patch: Partial<ReaderSettings>) => void
  onJump: (pdfPage: number) => void
  onExport: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { fonts, addFont, removeFont } = useFonts()
  const fontInput = useRef<HTMLInputElement>(null)
  const [fontError, setFontError] = useState<string | null>(null)
  const items = tocItems(book)
  const current = items.reduce((found, item) => (item.pdfPage <= page ? item : found), undefined as TocItem | undefined)
  const usingHeadings = (book.toc ?? []).length === 0
  const [tocOpen, setTocOpen] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className={`menu-layer theme-${settings.theme}`}>
      <div className="menu-scrim" onMouseDown={onClose} />
      <aside className="reader-menu" role="dialog" aria-label={t('menu.label')} onMouseDown={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <header className="menu-header">
          <div className="menu-header-actions">
            <button type="button" className="menu-export" onClick={onExport}>
              {t('menu.export')}
            </button>
            <button
              type="button"
              className={`menu-toc-toggle${tocOpen ? ' open' : ''}`}
              aria-expanded={tocOpen}
              onClick={() => setTocOpen((open) => !open)}
            >
              {t('menu.toc')}
            </button>
          </div>
          <button type="button" className="icon-button" aria-label={t('menu.closeButton')} onClick={onClose}>
            ✕
          </button>
        </header>
        {tocOpen && (
          <div className="menu-toc-panel" id="menu-toc">
            {items.length === 0 ? (
              <p className="menu-empty">{t('menu.noToc')}</p>
            ) : (
              <>
                {usingHeadings && <p className="menu-note">{t('menu.headingsNote')}</p>}
                <ul className="menu-toc">
                  {items.map((item) => (
                    <li key={`${item.pdfPage}-${item.title}`}>
                      <button
                        type="button"
                        className={item === current ? 'current' : undefined}
                        style={{ paddingLeft: 12 + (item.level - 1) * 14 }}
                        onClick={() => {
                          onJump(item.pdfPage)
                          onClose()
                        }}
                      >
                        <span>{item.title}</span>
                        <span className="toc-page">{item.bookPage}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        <div className="menu-body">
          <section className="menu-section">
            <h2 className="card-label">{t('menu.font')}</h2>
            <ul className="font-list">
              <li className="font-row">
                <button
                  type="button"
                  className={settings.fontId ? undefined : 'selected'}
                  onClick={() => onSettings({ fontId: null })}
                >
                  {t('menu.fontDefault')}
                </button>
              </li>
              {fonts.map((font) => (
                <li className="font-row" key={font.id}>
                  <button
                    type="button"
                    className={settings.fontId === font.id ? 'selected' : undefined}
                    style={{ fontFamily: font.family }}
                    onClick={() => onSettings({ fontId: font.id })}
                  >
                    {font.name}
                  </button>
                  <button
                    type="button"
                    className="font-delete"
                    onClick={() => {
                      if (settings.fontId === font.id) onSettings({ fontId: null })
                      void removeFont(font.id)
                    }}
                  >
                    {t('menu.fontDelete')}
                  </button>
                </li>
              ))}
            </ul>
            {fontError && <p className="menu-note">{fontError}</p>}
            <button type="button" className="font-upload" onClick={() => fontInput.current?.click()}>
              {t('menu.fontUpload')}
            </button>
            <input
              ref={fontInput}
              type="file"
              accept=".ttf,.otf,font/ttf,font/otf"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                setFontError(null)
                addFont(file).catch((error: unknown) => {
                  setFontError(error instanceof Error ? error.message : t('fonts.loadFailed'))
                })
              }}
            />
          </section>

          <section className="menu-section">
            <h2 className="card-label">{t('menu.fontSize')}</h2>
            <label className="slider-row">
              <span>{t('menu.small')}</span>
              <input
                type="range"
                min={15}
                max={24}
                step={1}
                value={settings.fontSize}
                aria-label={t('menu.fontSizeLabel')}
                onChange={(event) => onSettings({ fontSize: Number(event.target.value) })}
              />
              <span>{settings.fontSize}</span>
            </label>
          </section>

          <section className="menu-section">
            <h2 className="card-label">{t('menu.layout')}</h2>
            <label className="slider-row">
              <span>{t('menu.leading')}</span>
              <input
                type="range"
                min={1.4}
                max={2.2}
                step={0.05}
                value={settings.lineHeight}
                aria-label={t('menu.leadingLabel')}
                onChange={(event) => onSettings({ lineHeight: Number(event.target.value) })}
              />
              <span>{settings.lineHeight.toFixed(2)}</span>
            </label>
            <label className="slider-row">
              <span>{t('menu.margin')}</span>
              <input
                type="range"
                min={12}
                max={80}
                step={2}
                value={settings.margin}
                aria-label={t('menu.marginLabel')}
                onChange={(event) => onSettings({ margin: Number(event.target.value) })}
              />
              <span>{settings.margin}</span>
            </label>
            <div className="choice-row" role="group" aria-label={t('menu.theme')}>
              {THEME_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`choice theme-${id}${settings.theme === id ? ' selected' : ''}`}
                  aria-pressed={settings.theme === id}
                  onClick={() => onSettings({ theme: id })}
                >
                  {t(`menu.${id}`)}
                </button>
              ))}
            </div>
          </section>

          <section className="menu-section">
            <h2 className="card-label">{t('menu.pageMode')}</h2>
            <div className="choice-row" role="group" aria-label={t('menu.pageMode')}>
              <button
                type="button"
                className={settings.pageMode === 'scroll' ? 'choice selected' : 'choice'}
                aria-pressed={settings.pageMode === 'scroll'}
                onClick={() => onSettings({ pageMode: 'scroll' })}
              >
                {t('menu.scroll')}
              </button>
              <button
                type="button"
                className={settings.pageMode === 'flip' ? 'choice selected' : 'choice'}
                aria-pressed={settings.pageMode === 'flip'}
                onClick={() => onSettings({ pageMode: 'flip' })}
              >
                {t('menu.flip')}
              </button>
            </div>
            {settings.pageMode === 'flip' ? (
              <p className="menu-page-hint">
                <span>{t('menu.flipMobile')}</span>
                <span>{t('menu.flipDesktop')}</span>
              </p>
            ) : (
              <p className="menu-page-hint">{t('menu.scrollHint')}</p>
            )}
          </section>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
