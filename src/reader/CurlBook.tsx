import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { PageFlip } from 'page-flip/dist/js/page-flip.module.js'
import type { Paragraph } from '../pdf/extractParagraphs'
import type { Annotation } from '../lib/types'
import { AnnotatedParagraph } from './AnnotatedParagraph'
import { anchorOf, indexForPdf, pageIndexForAnchor, paginateParagraphs } from './paginate'
import type { ReadAnchor, ScreenPage } from './paginate'
import { anchorFromPoint, anchorFromRect, hasTextSelection } from './selection'
import type { Anchor } from './selection'

/** Matches the padding on `.curl-page`. */
const PAD_TOP = 16
const PAD_BOTTOM = 24

export type CurlHandle = {
  flip: (delta: number) => void
  jumpToPdf: (pdfPage: number) => void
}

type Props = {
  paragraphs: Paragraph[]
  pdfPage: number
  margin: number
  fontSize: number
  lineHeight: number
  fontFamily: string | null
  annotations: Annotation[]
  onMarksClick: (ids: string[], anchor: Anchor) => void
  onCommentClick: (id: string, anchor: Anchor) => void
  onPdfPage: (pdfPage: number) => void
}

export const CurlBook = forwardRef<CurlHandle, Props>(function CurlBook(
  {
    paragraphs,
    pdfPage,
    margin,
    fontSize,
    lineHeight,
    fontFamily,
    annotations,
    onMarksClick,
    onCommentClick,
    onPdfPage,
  },
  ref,
) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const flipRef = useRef<PageFlip | null>(null)
  const pagesRef = useRef<ScreenPage[]>([])
  const anchorRef = useRef<ReadAnchor | null>(null)
  const indexRef = useRef(0)
  const pdfPageRef = useRef(pdfPage)
  const annotationsRef = useRef(annotations)
  const handlersRef = useRef({ onMarksClick, onCommentClick, onPdfPage })
  const emptyRef = useRef(t('reader.emptyBook'))
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [pages, setPages] = useState<ScreenPage[]>([])
  const marksKey = annotations
    .map((annotation) => `${annotation.id}:${annotation.updatedAt}:${annotation.color ?? ''}:${annotation.comment ?? ''}`)
    .join('|')

  useLayoutEffect(() => {
    pdfPageRef.current = pdfPage
    annotationsRef.current = annotations
    handlersRef.current = { onMarksClick, onCommentClick, onPdfPage }
    emptyRef.current = t('reader.emptyBook')
  }, [annotations, onCommentClick, onMarksClick, onPdfPage, pdfPage, t])

  function report(index: number) {
    indexRef.current = index
    const page = pagesRef.current[index]
    const anchor = anchorOf(page)
    if (anchor) anchorRef.current = anchor
    const nextPdf = page?.slices[0]?.paragraph.startPage
    if (nextPdf) handlersRef.current.onPdfPage(nextPdf)
  }

  useImperativeHandle(ref, () => ({
    flip(delta: number) {
      if (delta > 0) flipRef.current?.flipNext('bottom')
      else flipRef.current?.flipPrev('top')
    },
    jumpToPdf(target: number) {
      const index = indexForPdf(pagesRef.current, target)
      anchorRef.current = anchorOf(pagesRef.current[index])
      flipRef.current?.turnToPage(index)
      report(index)
    },
  }))

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const measure = () => {
      const rect = host.getBoundingClientRect()
      const width = Math.floor(rect.width)
      const height = Math.floor(rect.height)
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const host = hostRef.current
    const reader = host?.closest('.reader')
    if (!host || !(reader instanceof HTMLElement) || size.width < 80 || size.height < 80) return
    const next = paginateParagraphs(paragraphs, {
      container: reader,
      contentWidth: Math.max(40, size.width - margin * 2),
      contentHeight: Math.max(40, size.height - PAD_TOP - PAD_BOTTOM - 8),
    })
    const index = pageIndexForAnchor(next, anchorRef.current, pdfPageRef.current)
    indexRef.current = index
    if (!anchorRef.current) anchorRef.current = anchorOf(next[index])
    pagesRef.current = next
    setPages(next)
  }, [paragraphs, size, margin, fontSize, lineHeight, fontFamily])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || pages.length === 0 || size.width < 80 || size.height < 80) return
    let cancelled = false
    let flip: PageFlip | null = null
    let book: HTMLElement | null = null
    let root: ReturnType<typeof createRoot> | null = null

    const onPointerUp = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || hasTextSelection()) return
      const comment = target.closest<HTMLElement>('[data-comment-id]')
      if (comment?.dataset.commentId) {
        handlersRef.current.onCommentClick(comment.dataset.commentId, anchorFromRect(comment.getBoundingClientRect()))
        return
      }
      const mark = target.closest<HTMLElement>('[data-mark-ids]')
      const ids = mark?.dataset.markIds?.split(' ').filter(Boolean) ?? []
      if (ids.length > 0) handlersRef.current.onMarksClick(ids, anchorFromPoint(event.clientX, event.clientY))
    }
    host.addEventListener('pointerup', onPointerUp)

    // Page content has to be drawn outside React's commit. flushSync during
    // useLayoutEffect is ignored, so the flip engine would receive empty pages.
    const timer = window.setTimeout(() => {
      if (cancelled) return
      const scratch = document.createElement('div')
      root = createRoot(scratch)
      const grouped = groupAnnotations(annotationsRef.current)
      flushSync(() => {
        root?.render(
          <CurlPages
            pages={pages}
            annotationsByParagraph={grouped}
            emptyLabel={emptyRef.current}
            onMarksClick={() => undefined}
            onCommentClick={() => undefined}
          />,
        )
      })
      const clones = [...scratch.querySelectorAll<HTMLElement>('.curl-page')].map(
        (page) => page.cloneNode(true) as HTMLElement,
      )
      root.unmount()
      root = null
      if (cancelled || clones.length === 0) return

      book = document.createElement('div')
      book.className = 'curl-book'
      for (const clone of clones) book.appendChild(clone)
      host.replaceChildren(book)
      try {
        flip = new PageFlip(book, {
          width: size.width,
          height: size.height,
          size: 'fixed',
          usePortrait: true,
          showCover: false,
          mobileScrollSupport: true,
          disableFlipByClick: true,
          swipeDistance: 100000,
          clickEventForward: true,
          startPage: indexRef.current,
          drawShadow: true,
          maxShadowOpacity: 0.4,
          flippingTime: 700,
          autoSize: true,
          showPageCorners: true,
          useMouseEvents: true,
        })
        flip.loadFromHTML(clones)
        flip.on('flip', (event) => {
          const index = typeof event.data === 'number' ? event.data : (flip?.getCurrentPageIndex() ?? 0)
          report(index)
        })
        flipRef.current = flip
      } catch (error) {
        console.error(error)
      }
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      host.removeEventListener('pointerup', onPointerUp)
      flipRef.current = null
      try {
        root?.unmount()
      } catch {
        // The scratch tree is already gone.
      }
      try {
        flip?.destroy()
      } catch {
        // destroy() removes its root element; a second pass can throw.
      }
      book?.remove()
    }
  }, [pages, marksKey, size.width, size.height])

  return <div ref={hostRef} className="curl-host" />
})

function groupAnnotations(annotations: Annotation[]): Map<number, Annotation[]> {
  const map = new Map<number, Annotation[]>()
  for (const annotation of annotations) {
    for (const paragraphId of new Set(annotation.ranges.map((range) => range.paragraphId))) {
      map.set(paragraphId, [...(map.get(paragraphId) ?? []), annotation])
    }
  }
  return map
}

function CurlPages({
  pages,
  annotationsByParagraph,
  emptyLabel,
  onMarksClick,
  onCommentClick,
}: {
  pages: ScreenPage[]
  annotationsByParagraph: Map<number, Annotation[]>
  emptyLabel: string
  onMarksClick: (ids: string[], anchor: Anchor) => void
  onCommentClick: (id: string, anchor: Anchor) => void
}): ReactNode {
  return pages.map((page, index) => (
    <div className="curl-page" key={index}>
      {page.slices.length === 0 ? (
        <p className="reader-message">{emptyLabel}</p>
      ) : (
        page.slices.map((slice) => (
          <AnnotatedParagraph
            key={`${slice.paragraph.id}-${slice.start}`}
            paragraph={slice.paragraph}
            annotations={annotationsByParagraph.get(slice.paragraph.id) ?? []}
            start={slice.start}
            end={slice.end}
            onMarksClick={onMarksClick}
            onCommentClick={onCommentClick}
          />
        ))
      )}
    </div>
  ))
}
