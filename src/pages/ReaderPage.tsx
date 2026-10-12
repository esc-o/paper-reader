import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deleteAnnotation, getBook, listAnnotations, saveAnnotation, saveProgress } from '../lib/db'
import { routes } from '../lib/router'
import type { Annotation, Book, HighlightColor } from '../lib/types'
import { useReadingTimer } from '../lib/useReadingTimer'
import { AnnotatedParagraph } from '../reader/AnnotatedParagraph'
import { CommentPopover, MarksPopover, NewCommentPopover } from '../reader/AnnotationPopovers'
import { LookupPanel } from '../reader/LookupPanel'
import { SelectionToolbar } from '../reader/SelectionToolbar'
import { clearBrowserSelection, readSelection } from '../reader/selection'
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
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [selection, setSelection] = useState<PendingSelection | null>(null)
  const [popover, setPopover] = useState<Popover | null>(null)
  const [lookupText, setLookupText] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useReadingTimer()

  useEffect(() => {
    let cancelled = false
    Promise.all([getBook(bookId), listAnnotations(bookId)]).then(([found, saved]) => {
      if (cancelled) return
      setBook(found ?? null)
      setAnnotations(saved)
      if (found) {
        setPage(found.currentPage)
        saveProgress(found.id, found.currentPage)
      }
    })
    return () => {
      cancelled = true
    }
  }, [bookId])

  const goToPage = useCallback(
    (target: number) => {
      if (!book) return
      const next = Math.min(Math.max(1, target), book.numPages)
      if (next === page) return
      clearBrowserSelection()
      setSelection(null)
      setPopover(null)
      setPage(next)
      window.scrollTo({ top: 0 })
      saveProgress(book.id, next)
    },
    [book, page],
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.target instanceof Element && e.target.closest('input, textarea')) return
      if (e.key === 'ArrowRight') goToPage(page + 1)
      if (e.key === 'ArrowLeft') goToPage(page - 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goToPage, page])

  // Show the toolbar once the user has finished selecting (mouse released, or selection settled on touch).
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

  const pageParagraphs = useMemo(
    () => book?.paragraphs.filter((p) => p.startPage === page) ?? [],
    [book, page],
  )

  const annotationsByParagraph = useMemo(() => {
    const map = new Map<number, Annotation[]>()
    for (const a of annotations) {
      for (const paragraphId of new Set(a.ranges.map((r) => r.paragraphId))) {
        map.set(paragraphId, [...(map.get(paragraphId) ?? []), a])
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
    const current = annotations.find((a) => a.id === id)
    if (!current) return
    const updated = { ...current, ...patch, updatedAt: Date.now() }
    setAnnotations((list) => list.map((a) => (a.id === id ? updated : a)))
    saveAnnotation(updated)
  }

  function removeAnnotation(id: string) {
    setAnnotations((list) => list.filter((a) => a.id !== id))
    deleteAnnotation(id)
  }

  function openLookup(target: PendingSelection) {
    setLookupText(target.text)
    setPopover(null)
    dismissSelection()
    // Keep the selected words visible above the bottom sheet on phones.
    if (window.matchMedia('(max-width: 899px)').matches) {
      const visibleTop = target.anchor.top - window.scrollY
      if (visibleTop > window.innerHeight * 0.4) {
        requestAnimationFrame(() => window.scrollTo({ top: target.anchor.top - 96, behavior: 'smooth' }))
      }
    }
  }

  const openMarks = useCallback((ids: string[], anchor: Anchor) => {
    setPopover({ kind: 'marks', anchor, ids })
  }, [])
  const openComment = useCallback((id: string, anchor: Anchor) => {
    setPopover({ kind: 'comment', anchor, id })
  }, [])
  const closePopover = useCallback(() => setPopover(null), [])
  const closeLookup = useCallback(() => setLookupText(null), [])

  if (book === undefined) {
    return <div className="reader"><p className="reader-message">正在打开…</p></div>
  }
  if (book === null) {
    return (
      <div className="reader">
        <p className="reader-message">
          没找到这篇文献，可能已经被删除了。<a href={routes.shelf}>回到书架</a>
        </p>
      </div>
    )
  }

  const popoverMarks =
    popover?.kind === 'marks'
      ? annotations.filter((a) => popover.ids.includes(a.id))
      : []
  const popoverComment =
    popover?.kind === 'comment' ? annotations.find((a) => a.id === popover.id) : undefined

  return (
    <div className={`reader${lookupText ? ' with-panel' : ''}`}>
      <header className="reader-bar">
        <a className="reader-back" href={routes.home}>← 首页</a>
        <span className="reader-title" title={book.title}>{book.title}</span>
        <span className="reader-page-count">{page} / {book.numPages}</span>
      </header>

      <div className="reader-content" ref={contentRef}>
        {pageParagraphs.length === 0 && (
          <p className="reader-message">这一页没有单独的文字段落（可能是图表页，或者内容接在上一页的段落里）。</p>
        )}
        {pageParagraphs.map((p) => (
          <AnnotatedParagraph
            key={p.id}
            paragraph={p}
            annotations={annotationsByParagraph.get(p.id) ?? NO_ANNOTATIONS}
            onMarksClick={openMarks}
            onCommentClick={openComment}
          />
        ))}
      </div>

      <nav className="pager">
        <button type="button" className="pager-button" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
          ← 上一页
        </button>
        <span className="pager-count">第 {page} / {book.numPages} 页</span>
        <button
          type="button"
          className="pager-button"
          disabled={page >= book.numPages}
          onClick={() => goToPage(page + 1)}
        >
          下一页 →
        </button>
      </nav>

      {selection && !popover && (
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
    </div>
  )
}

const NO_ANNOTATIONS: Annotation[] = []
