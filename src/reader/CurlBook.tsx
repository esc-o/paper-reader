import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LookedUpWord } from '../lib/lookup'
import type { Paragraph } from '../pdf/extractParagraphs'
import type { Annotation } from '../lib/types'
import { AnnotatedParagraph } from './AnnotatedParagraph'
import { anchorOf, indexForPdf, pageIndexForAnchor, paginateParagraphs } from './paginate'
import type { ReadAnchor, ScreenPage } from './paginate'
import type { Anchor } from './selection'

/** Matches the padding on `.curl-page`. */
const PAD_TOP = 16
const PAD_BOTTOM = 24

export type CurlHandle = {
  flip: (delta: number) => void
  jumpToPdf: (pdfPage: number) => void
  /** Turns to the screen page that contains this character. False until the book is ready. */
  jumpToText: (paragraphId: number, charOffset: number) => boolean
}

type Props = {
  paragraphs: Paragraph[]
  pdfPage: number
  margin: number
  fontSize: number
  lineHeight: number
  fontFamily: string | null
  annotations: Annotation[]
  lookups?: LookedUpWord[]
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
    lookups = [],
    onMarksClick,
    onCommentClick,
    onPdfPage,
  },
  ref,
) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<ScreenPage[]>([])
  const anchorRef = useRef<ReadAnchor | null>(null)
  const indexRef = useRef(0)
  const pdfPageRef = useRef(pdfPage)
  const onPdfPageRef = useRef(onPdfPage)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [pages, setPages] = useState<ScreenPage[]>([])
  const [index, setIndex] = useState(0)

  useLayoutEffect(() => {
    pdfPageRef.current = pdfPage
    onPdfPageRef.current = onPdfPage
  }, [onPdfPage, pdfPage])

  const show = useCallback((next: number) => {
    const count = pagesRef.current.length
    if (count === 0) return false
    const at = Math.min(Math.max(0, next), count - 1)
    indexRef.current = at
    const page = pagesRef.current[at]
    const anchor = anchorOf(page)
    if (anchor) anchorRef.current = anchor
    setIndex(at)
    const nextPdf = page?.slices[0]?.paragraph.startPage
    if (nextPdf) onPdfPageRef.current(nextPdf)
    return true
  }, [])

  useImperativeHandle(ref, () => ({
    flip(delta: number) {
      show(indexRef.current + (delta > 0 ? 1 : -1))
    },
    jumpToPdf(target: number) {
      const next = indexForPdf(pagesRef.current, target)
      anchorRef.current = anchorOf(pagesRef.current[next])
      show(next)
    },
    jumpToText(paragraphId: number, charOffset: number) {
      if (pagesRef.current.length === 0) return false
      const next = pageIndexForAnchor(pagesRef.current, { paragraphId, charOffset }, pdfPageRef.current)
      anchorRef.current = anchorOf(pagesRef.current[next])
      show(next)
      return true
    },
  }), [show])

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
    const at = pageIndexForAnchor(next, anchorRef.current, pdfPageRef.current)
    pagesRef.current = next
    if (!anchorRef.current) anchorRef.current = anchorOf(next[at])
    setPages(next)
    show(at)
  }, [fontFamily, fontSize, lineHeight, margin, paragraphs, show, size])

  const annotationsByParagraph = useMemo(() => {
    const map = new Map<number, Annotation[]>()
    for (const annotation of annotations) {
      for (const paragraphId of new Set(annotation.ranges.map((range) => range.paragraphId))) {
        map.set(paragraphId, [...(map.get(paragraphId) ?? []), annotation])
      }
    }
    return map
  }, [annotations])

  const page = pages[index]

  return (
    <div ref={hostRef} className="curl-host">
      {page && (
        <div className="curl-page">
          {page.slices.length === 0 ? (
            <p className="reader-message">{t('reader.emptyBook')}</p>
          ) : (
            page.slices.map((slice) => (
              <AnnotatedParagraph
                key={`${slice.paragraph.id}-${slice.start}`}
                paragraph={slice.paragraph}
                annotations={annotationsByParagraph.get(slice.paragraph.id) ?? []}
                start={slice.start}
                end={slice.end}
                lookups={lookups}
                onMarksClick={onMarksClick}
                onCommentClick={onCommentClick}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
})
