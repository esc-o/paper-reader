import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { TopActions } from '../components/TopActions'
import { LIBRARY_EVENT } from '../lib/changes'
import { deleteAnnotation, getBook, listAnnotations, saveAnnotation, saveBook, saveProgress } from '../lib/db'
import { familyFor, useFonts } from '../lib/fonts'
import { importPdf, prepareBook } from '../lib/library'
import { routes } from '../lib/router'
import { useStoredSettings } from '../lib/settings'
import { displayPage } from '../lib/toc'
import type { Annotation, Book, HighlightColor } from '../lib/types'
import { useNarrow } from '../lib/useNarrow'
import { useReadingTimer } from '../lib/useReadingTimer'
import { AnnotatedParagraph } from '../reader/AnnotatedParagraph'
import { CommentPopover, MarksPopover, NewCommentPopover } from '../reader/AnnotationPopovers'
import { CurlBook } from '../reader/CurlBook'
import type { CurlHandle } from '../reader/CurlBook'
import { ExportDialog } from '../reader/ExportDialog'
import { LookupPanel } from '../reader/LookupPanel'
import { ReaderMenu, ReadingFab } from '../reader/ReaderMenu'
import { SelectionToolbar } from '../reader/SelectionToolbar'
import { clearBrowserSelection, hasTextSelection, readSelection } from '../reader/selection'
import type { Anchor, PendingSelection } from '../reader/selection'
import './ReaderPage.css'

const DEFAULT_UNDERLINE_COLOR: HighlightColor = 'blue'

type Popover =
  | { kind: 'new-comment'; anchor: Anchor; target: PendingSelection }
  | { kind: 'marks'; anchor: Anchor; ids: string[] }
  | { kind: 'comment'; anchor: Anchor; id: string }

export function ReaderPage({ bookId }: { bookId: string }) {
  const [book, setBook] = useState<Book | null | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [turn, setTurn] = useState<1 | -1 | 0>(0)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [selection, setSelection] = useState<PendingSelection | null>(null)
  const [popover, setPopover] = useState<Popover | null>(null)
  const [lookupText, setLookupText] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [settings, updateSettings] = useStoredSettings()
  const { t } = useTranslation()
  const narrow = useNarrow()
  const { fonts } = useFonts()
  const fontFamily = familyFor(fonts, settings.fontId)
  const curl = settings.pageMode === 'flip' && narrow
  const contentRef = useRef<HTMLDivElement>(null)
  const curlRef = useRef<CurlHandle>(null)
  const pageRef = useRef(page)
  const menuOpenRef = useRef(menuOpen)
  const [reimportError, setReimportError] = useState<string | null>(null)
  const [reimporting, setReimporting] = useState(false)
  useEffect(() => {
    pageRef.current = page
    menuOpenRef.current = menuOpen
  }, [page, menuOpen])

  useReadingTimer()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [found, saved] = await Promise.all([getBook(bookId), listAnnotations(bookId)])
      if (cancelled) return
      if (!found) {
        setBook(null)
        setAnnotations(saved)
        return
      }
      const prepared = prepareBook(found)
      if (prepared.changed) await saveBook(prepared.book)
      if (cancelled) return
      setBook(prepared.book)
      setAnnotations(saved)
      setPage(prepared.book.currentPage)
      saveProgress(prepared.book.id, prepared.book.currentPage)
    })()
    return () => {
      cancelled = true
    }
  }, [bookId])

  useEffect(() => {
    const refresh = async () => {
      const [found, saved] = await Promise.all([getBook(bookId), listAnnotations(bookId)])
      setAnnotations(saved)
      if (!found) return
      setBook((prev) => {
        if (!prev) return prepareBook(found).book
        if (prev.needsFile && found.paragraphs.length > 0) return prepareBook(found).book
        if (prev.paragraphs.length > 0 && found.paragraphs.length === 0) {
          return { ...prev, currentPage: found.currentPage, lastReadAt: found.lastReadAt, updatedAt: found.updatedAt }
        }
        if (prev.updatedAt === found.updatedAt && prev.currentPage === found.currentPage) return prev
        return { ...prev, ...prepareBook(found).book, paragraphs: prev.paragraphs.length > 0 ? prev.paragraphs : found.paragraphs }
      })
      if (found.currentPage !== pageRef.current && (found.updatedAt ?? 0) > 0) {
        pageRef.current = found.currentPage
        setPage(found.currentPage)
        curlRef.current?.jumpToPdf(found.currentPage)
      }
    }
    window.addEventListener(LIBRARY_EVENT, refresh)
    return () => window.removeEventListener(LIBRARY_EVENT, refresh)
  }, [bookId])

  const onCurlPage = useCallback((pdfPage: number) => {
    if (!book || pdfPage === pageRef.current) return
    pageRef.current = pdfPage
    setPage(pdfPage)
    saveProgress(book.id, pdfPage)
  }, [book])

  const goToPage = useCallback(
    (target: number) => {
      if (!book) return
      const next = Math.min(Math.max(1, target), book.numPages)
      if (curlRef.current) {
        clearBrowserSelection()
        setSelection(null)
        setPopover(null)
        curlRef.current.jumpToPdf(next)
        return
      }
      if (next === page) return
      clearBrowserSelection()
      setSelection(null)
      setPopover(null)
      setTurn(next > page ? 1 : -1)
      setPage(next)
      saveProgress(book.id, next)
      if (settings.pageMode === 'scroll') {
        document.querySelector(`[data-page="${next}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        window.scrollTo({ top: 0 })
      }
    },
    [book, page, settings.pageMode],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.target instanceof Element && event.target.closest('input, textarea')) return
      if (menuOpen) {
        if (event.key === 'Escape') setMenuOpen(false)
        return
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        if (curlRef.current) {
          curlRef.current.flip(event.key === 'ArrowRight' ? 1 : -1)
          return
        }
        if (event.key === 'ArrowRight') goToPage(page + 1)
        if (event.key === 'ArrowLeft') goToPage(page - 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goToPage, menuOpen, page])

  useEffect(() => {
    const el = contentRef.current
    if (!el || settings.pageMode !== 'flip' || narrow) return
    let startX = 0
    let startY = 0
    const onStart = (event: TouchEvent) => {
      startX = event.touches[0].clientX
      startY = event.touches[0].clientY
    }
    const onEnd = (event: TouchEvent) => {
      const dx = event.changedTouches[0].clientX - startX
      const dy = event.changedTouches[0].clientY - startY
      if (menuOpenRef.current || Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.2) return
      goToPage(pageRef.current + (dx < 0 ? 1 : -1))
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend', onEnd)
    }
  }, [goToPage, narrow, settings.pageMode])

  useEffect(() => {
    if (!book || settings.pageMode !== 'scroll') return
    document.querySelector(`[data-page="${pageRef.current}"]`)?.scrollIntoView()
    let ready = false
    const arm = window.setTimeout(() => {
      ready = true
    }, 400)
    const sections = contentRef.current?.querySelectorAll<HTMLElement>('[data-page]')
    if (!sections) return () => window.clearTimeout(arm)
    const observer = new IntersectionObserver(
      (entries) => {
        if (!ready) return
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (!visible) return
        const next = Number((visible.target as HTMLElement).dataset.page)
        if (!next || next === pageRef.current) return
        pageRef.current = next
        setPage(next)
        saveProgress(book.id, next)
      },
      { rootMargin: '-12% 0px -70% 0px', threshold: 0 },
    )
    sections.forEach((section) => observer.observe(section))
    return () => {
      window.clearTimeout(arm)
      observer.disconnect()
    }
  }, [book, settings.pageMode])

  useEffect(() => {
    let pointerIsDown = false
    let timer: number | undefined
    const update = () => setSelection(readSelection(contentRef.current))
    const onPointerDown = () => {
      pointerIsDown = true
    }
    const onPointerUp = () => {
      pointerIsDown = false
      window.setTimeout(update, 0)
    }
    const onSelectionChange = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (!pointerIsDown) update()
      }, 250)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerUp)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerUp)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [])

  const annotationsByParagraph = useMemo(() => {
    const map = new Map<number, Annotation[]>()
    for (const annotation of annotations) {
      for (const paragraphId of new Set(annotation.ranges.map((range) => range.paragraphId))) {
        map.set(paragraphId, [...(map.get(paragraphId) ?? []), annotation])
      }
    }
    return map
  }, [annotations])

  function dismissSelection() {
    clearBrowserSelection()
    setSelection(null)
  }

  function createAnnotation(target: PendingSelection, fields: Pick<Annotation, 'kind' | 'color' | 'comment'>) {
    const now = Date.now()
    const annotation: Annotation = {
      id: crypto.randomUUID(),
      bookId,
      page,
      ranges: target.ranges,
      text: target.text,
      createdAt: now,
      updatedAt: now,
      ...fields,
    }
    setAnnotations((list) => [...list, annotation])
    saveAnnotation(annotation)
  }

  function updateAnnotation(id: string, patch: Partial<Pick<Annotation, 'color' | 'comment'>>) {
    const current = annotations.find((annotation) => annotation.id === id)
    if (!current) return
    const updated = { ...current, ...patch, updatedAt: Date.now() }
    setAnnotations((list) => list.map((annotation) => (annotation.id === id ? updated : annotation)))
    saveAnnotation(updated)
  }

  function removeAnnotation(id: string) {
    setAnnotations((list) => list.filter((annotation) => annotation.id !== id))
    deleteAnnotation(id)
  }

  function openLookup(target: PendingSelection) {
    setLookupText(target.text)
    setPopover(null)
    setMenuOpen(false)
    dismissSelection()
    if (window.matchMedia('(max-width: 899px)').matches) {
      const visibleTop = target.anchor.top - window.scrollY
      if (visibleTop > window.innerHeight * 0.4) {
        requestAnimationFrame(() => window.scrollTo({ top: target.anchor.top - 96, behavior: 'smooth' }))
      }
    }
  }

  function toggleMenu() {
    setMenuOpen((open) => !open)
    dismissSelection()
    setPopover(null)
  }

  function onReaderClick(event: ReactMouseEvent) {
    if (lookupText || menuOpen) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('a, button, input, textarea, .mark, .comment-bubble, .floating')) return
    if (hasTextSelection()) return
    const x = event.clientX / window.innerWidth
    const y = event.clientY / window.innerHeight
    if (x < 0.3 || x > 0.7 || y < 0.22 || y > 0.78) return
    toggleMenu()
  }

  const openMarks = useCallback((ids: string[], anchor: Anchor) => {
    setPopover({ kind: 'marks', anchor, ids })
  }, [])
  const openComment = useCallback((id: string, anchor: Anchor) => {
    setPopover({ kind: 'comment', anchor, id })
  }, [])
  const closePopover = useCallback(() => setPopover(null), [])
  const closeLookup = useCallback(() => setLookupText(null), [])
  const closeMenu = useCallback(() => setMenuOpen(false), [])

  async function reimportFile(file: File) {
    setReimporting(true)
    setReimportError(null)
    try {
      const id = await importPdf(file)
      if (id !== bookId) {
        window.location.hash = routes.reader(id)
        return
      }
      const found = await getBook(bookId)
      if (!found) return
      const prepared = prepareBook(found)
      if (prepared.changed) await saveBook(prepared.book)
      setBook(prepared.book)
      setPage(prepared.book.currentPage)
      setAnnotations(await listAnnotations(bookId))
    } catch (error) {
      console.error(error)
      setReimportError(error instanceof Error ? error.message : t('reader.importFailed'))
    } finally {
      setReimporting(false)
    }
  }

  if (book === undefined) {
    return <div className="reader"><p className="reader-message">{t('reader.opening')}</p></div>
  }
  if (book === null) {
    return (
      <div className="reader">
        <p className="reader-message">
          {t('reader.missing')} <a href={routes.shelf}>{t('nav.backShelf')}</a>
        </p>
      </div>
    )
  }

  const popoverMarks = popover?.kind === 'marks' ? annotations.filter((annotation) => popover.ids.includes(annotation.id)) : []
  const popoverComment = popover?.kind === 'comment' ? annotations.find((annotation) => annotation.id === popover.id) : undefined
  const pages = settings.pageMode === 'scroll' ? Array.from({ length: book.numPages }, (_, index) => index + 1) : [page]
  const typeface = fontFamily ? `'${fontFamily}', sans-serif` : undefined

  return (
    <div
      className={`reader theme-${settings.theme} mode-${settings.pageMode}${curl ? ' curl' : ''}${lookupText ? ' with-panel' : ''}`}
      style={{
        '--reader-font': `${settings.fontSize}px`,
        '--reader-leading': String(settings.lineHeight),
        '--reader-margin': `${settings.margin}px`,
        '--reader-typeface': typeface,
      } as CSSProperties}
      onClick={onReaderClick}
    >
      <header className="reader-bar">
        <a className="reader-back" href={routes.home}>{t('nav.backHome')}</a>
        <span className="reader-title" title={book.title}>{book.title}</span>
        <span className="reader-page-count">{page} / {book.numPages}</span>
        <TopActions />
      </header>

      <div className="reader-content" ref={contentRef}>
        {book.needsFile ? (
          <div className="reimport">
            <p>{t('reader.reimport')}</p>
            <label className="solid-button reimport-button">
              {reimporting ? t('errors.opening') : t('reader.reimportButton')}
              <input
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void reimportFile(file)
                  event.target.value = ''
                }}
              />
            </label>
            {reimportError && <p className="reimport-error">{reimportError}</p>}
          </div>
        ) : curl ? (
          <CurlBook
            ref={curlRef}
            paragraphs={book.paragraphs}
            pdfPage={page}
            margin={settings.margin}
            fontSize={settings.fontSize}
            lineHeight={settings.lineHeight}
            fontFamily={fontFamily}
            annotations={annotations}
            onMarksClick={openMarks}
            onCommentClick={openComment}
            onPdfPage={onCurlPage}
          />
        ) : (
          pages.map((pageNumber) => (
            <PageSection
              key={pageNumber}
              book={book}
              pageNumber={pageNumber}
              turn={turn}
              annotationsByParagraph={annotationsByParagraph}
              onMarksClick={openMarks}
              onCommentClick={openComment}
            />
          ))
        )}
      </div>

      {settings.pageMode === 'flip' && !curl && !book.needsFile && (
        <nav className="pager">
          <button type="button" className="pager-button" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
            {t('reader.prev')}
          </button>
          <span className="pager-count">{t('reader.pager', { page, total: book.numPages })}</span>
          <button type="button" className="pager-button" disabled={page >= book.numPages} onClick={() => goToPage(page + 1)}>
            {t('reader.next')}
          </button>
        </nav>
      )}

      {selection && !popover && !menuOpen && (
        <SelectionToolbar
          selection={selection}
          onHighlight={(color) => {
            createAnnotation(selection, { kind: 'highlight', color })
            dismissSelection()
          }}
          onUnderline={() => {
            createAnnotation(selection, { kind: 'underline', color: DEFAULT_UNDERLINE_COLOR })
            dismissSelection()
          }}
          onComment={() => {
            setPopover({ kind: 'new-comment', anchor: selection.anchor, target: selection })
            dismissSelection()
          }}
          onLookup={() => openLookup(selection)}
          onCancel={dismissSelection}
        />
      )}

      {popover?.kind === 'new-comment' && (
        <NewCommentPopover
          anchor={popover.anchor}
          quote={popover.target.text}
          onClose={closePopover}
          onSave={(comment) => {
            createAnnotation(popover.target, { kind: 'comment', comment })
            setPopover(null)
          }}
        />
      )}

      {popover?.kind === 'marks' && popoverMarks.length > 0 && (
        <MarksPopover
          anchor={popover.anchor}
          annotations={popoverMarks}
          onClose={closePopover}
          onChangeColor={(id, color) => updateAnnotation(id, { color })}
          onDelete={(id) => {
            removeAnnotation(id)
            if (popoverMarks.length === 1) setPopover(null)
          }}
        />
      )}

      {popover?.kind === 'comment' && popoverComment && (
        <CommentPopover
          anchor={popover.anchor}
          annotation={popoverComment}
          onClose={closePopover}
          onSave={(comment) => updateAnnotation(popoverComment.id, { comment })}
          onDelete={() => {
            removeAnnotation(popoverComment.id)
            setPopover(null)
          }}
        />
      )}

      {lookupText && <LookupPanel key={lookupText} text={lookupText} onClose={closeLookup} />}

      <ReadingFab open={menuOpen} position={settings.fab} onPosition={(fab) => updateSettings({ fab })} onToggle={toggleMenu} />
      {menuOpen && (
        <ReaderMenu
          book={book}
          page={page}
          settings={settings}
          onSettings={updateSettings}
          onJump={goToPage}
          onExport={() => {
            setMenuOpen(false)
            setExportOpen(true)
          }}
          onClose={closeMenu}
        />
      )}
      {exportOpen && <ExportDialog book={book} annotations={annotations} onClose={() => setExportOpen(false)} />}
    </div>
  )
}

function PageSection({
  book,
  pageNumber,
  turn,
  annotationsByParagraph,
  onMarksClick,
  onCommentClick,
}: {
  book: Book
  pageNumber: number
  turn: 1 | -1 | 0
  annotationsByParagraph: Map<number, Annotation[]>
  onMarksClick: (ids: string[], anchor: Anchor) => void
  onCommentClick: (id: string, anchor: Anchor) => void
}) {
  const { t } = useTranslation()
  const onPage = book.paragraphs.filter((paragraph) => paragraph.startPage === pageNumber)
  const visible = onPage.filter((paragraph) => !paragraph.isToc)
  const bookPage = displayPage(pageNumber, book.pageOffset ?? 0)

  return (
    <section className="reader-page" data-page={pageNumber} data-turn={turn}>
      <div className="page-sep">— {bookPage} —</div>
      {visible.length === 0 && (
        <p className="reader-message">
          {onPage.length > 0 ? t('reader.tocHidden') : t('reader.noText')}
        </p>
      )}
      {visible.map((paragraph) => (
        <AnnotatedParagraph
          key={paragraph.id}
          paragraph={paragraph}
          annotations={annotationsByParagraph.get(paragraph.id) ?? NO_ANNOTATIONS}
          onMarksClick={onMarksClick}
          onCommentClick={onCommentClick}
        />
      ))}
    </section>
  )
}

const NO_ANNOTATIONS: Annotation[] = []
