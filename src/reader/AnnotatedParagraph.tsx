import { memo, useMemo } from 'react'
import type { CSSProperties, MouseEvent, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { LookedUpWord } from '../lib/lookup'
import { normalizeWord } from '../lib/lookup'
import type { Paragraph } from '../pdf/extractParagraphs'
import type { Annotation } from '../lib/types'
import { anchorFromPoint, anchorFromRect, hasTextSelection } from './selection'
import type { Anchor } from './selection'

type Props = {
  paragraph: Paragraph
  annotations: Annotation[]
  /** Inclusive start into `paragraph.text`. Omit to show the whole paragraph. */
  start?: number
  /** Exclusive end into `paragraph.text`. */
  end?: number
  onMarksClick: (ids: string[], anchor: Anchor) => void
  onCommentClick: (id: string, anchor: Anchor) => void
  lookups?: LookedUpWord[]
}

type Segment = {
  start: number
  end: number
  /** Annotations covering this segment, oldest first. */
  covering: Annotation[]
  /** Comments whose text ends here, so their bubble goes right after this segment. */
  commentsEndingHere: Annotation[]
}

function buildSegments(paragraph: Paragraph, annotations: Annotation[], from: number, to: number): Segment[] {
  const { id, text } = paragraph
  const local = annotations.flatMap((a) =>
    a.ranges
      .filter((r) => r.paragraphId === id)
      .flatMap((r) => {
        const start = Math.max(from, r.start)
        const end = Math.min(to, r.end)
        if (end <= start) return []
        return [{ annotation: a, start, end }]
      }),
  )
  const points = [...new Set([from, to, ...local.flatMap((l) => [l.start, l.end])])].sort((a, b) => a - b)

  const segments: Segment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]
    const end = points[i + 1]
    if (end <= start) continue
    const covering = local
      .filter((l) => l.start <= start && l.end >= end)
      .map((l) => l.annotation)
      .sort((a, b) => a.createdAt - b.createdAt)
    const commentsEndingHere = annotations.filter((a) => {
      const last = a.ranges.at(-1)
      if (a.kind !== 'comment' || last?.paragraphId !== id) return false
      const originalEnd = Math.min(text.length, last.end)
      return originalEnd === end && originalEnd > from && originalEnd <= to
    })
    segments.push({ start, end, covering, commentsEndingHere })
  }
  return segments
}

function segmentStyle(covering: Annotation[]): CSSProperties {
  const highlight = covering.findLast((a) => a.kind === 'highlight')
  const underline = covering.findLast((a) => a.kind === 'underline')
  return {
    backgroundColor: highlight ? `var(--hl-${highlight.color ?? 'yellow'})` : undefined,
    textDecorationLine: underline ? 'underline' : undefined,
    textDecorationColor: underline ? `var(--ul-${underline.color ?? 'blue'})` : undefined,
  }
}

export const AnnotatedParagraph = memo(function AnnotatedParagraph({
  paragraph,
  annotations,
  start = 0,
  end,
  onMarksClick,
  onCommentClick,
  lookups = [],
}: Props) {
  const to = end ?? paragraph.text.length
  const segments = useMemo(
    () => buildSegments(paragraph, annotations, start, to),
    [paragraph, annotations, start, to],
  )
  const lookupRanges = useMemo(() => findLookupRanges(paragraph.text, lookups), [paragraph.text, lookups])
  const { t } = useTranslation()
  const Text = paragraph.isHeading ? 'h3' : 'p'

  if (paragraph.image) {
    return (
      <figure className="paragraph figure">
        <img
          src={paragraph.image}
          alt=""
          width={paragraph.imageWidth}
          height={paragraph.imageHeight}
          draggable={false}
        />
      </figure>
    )
  }

  function handleMarkClick(event: MouseEvent, covering: Annotation[]) {
    if (hasTextSelection()) return
    const anchor = anchorFromPoint(event.clientX, event.clientY)
    const marks = covering.filter((a) => a.kind !== 'comment')
    if (marks.length > 0) onMarksClick(marks.map((a) => a.id), anchor)
    else onCommentClick(covering[0].id, anchor)
  }

  return (
    <div className={`paragraph${paragraph.isHeading ? ' heading' : ''}`}>
      <Text className="paragraph-text" data-paragraph-id={paragraph.id} data-char-offset={start}>
        {segments.map((segment) => {
          const text = paragraph.text.slice(segment.start, segment.end)
          const { covering } = segment
          const body = renderLookups(text, segment.start, lookupRanges)
          return (
            <span key={segment.start}>
              {covering.length === 0 ? (
                body
              ) : (
                <span
                  className={`mark${covering.some((a) => a.kind === 'comment') ? ' commented' : ''}`}
                  style={segmentStyle(covering)}
                  data-mark-ids={
                    covering.some((a) => a.kind !== 'comment')
                      ? covering
                          .filter((a) => a.kind !== 'comment')
                          .map((a) => a.id)
                          .join(' ')
                      : undefined
                  }
                  data-comment-id={
                    covering.some((a) => a.kind !== 'comment') ? undefined : covering[0]?.id
                  }
                  onClick={(e) => handleMarkClick(e, covering)}
                >
                  {body}
                </span>
              )}
              {segment.commentsEndingHere.map((comment) => (
                <button
                  key={comment.id}
                  type="button"
                  className="comment-bubble"
                  data-comment-id={comment.id}
                  aria-label={t('comment.view')}
                  onClick={(e) => onCommentClick(comment.id, anchorFromRect(e.currentTarget.getBoundingClientRect()))}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 2.5h10A1.5 1.5 0 0 1 14.5 4v6A1.5 1.5 0 0 1 13 11.5H7l-3.5 3v-3H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5Z" />
                  </svg>
                </button>
              ))}
            </span>
          )
        })}
      </Text>
    </div>
  )
})

type LookupSpan = { start: number; end: number; gloss: string }

function findLookupRanges(text: string, lookups: LookedUpWord[]): LookupSpan[] {
  if (lookups.length === 0 || !text) return []
  const glossByWord = new Map(lookups.map((item) => [item.word, item.gloss]))
  const alternation = [...glossByWord.keys()]
    .sort((a, b) => b.length - a.length)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  if (!alternation) return []
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, 'giu')
  const found: LookupSpan[] = []
  for (const match of text.matchAll(pattern)) {
    if (match.index == null) continue
    const gloss = glossByWord.get(normalizeWord(match[0]))
    if (!gloss) continue
    found.push({ start: match.index, end: match.index + match[0].length, gloss })
  }
  return found
}

function renderLookups(text: string, base: number, ranges: LookupSpan[]) {
  const local = ranges.filter((range) => range.end > base && range.start < base + text.length)
  if (local.length === 0) return text
  const parts: (string | ReactElement)[] = []
  let cursor = 0
  for (const range of local) {
    const start = Math.max(0, range.start - base)
    const end = Math.min(text.length, range.end - base)
    if (end <= start) continue
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(
      <span key={base + start} className="looked-up" data-gloss={range.gloss}>
        {text.slice(start, end)}
      </span>,
    )
    cursor = end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}
