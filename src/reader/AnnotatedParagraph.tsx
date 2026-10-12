import { memo, useMemo } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import type { Paragraph } from '../pdf/extractParagraphs'
import type { Annotation } from '../lib/types'
import { anchorFromPoint, anchorFromRect, hasTextSelection } from './selection'
import type { Anchor } from './selection'

type Props = {
  paragraph: Paragraph
  annotations: Annotation[]
  onMarksClick: (ids: string[], anchor: Anchor) => void
  onCommentClick: (id: string, anchor: Anchor) => void
}

type Segment = {
  start: number
  end: number
  /** Annotations covering this segment, oldest first. */
  covering: Annotation[]
  /** Comments whose text ends here, so their bubble goes right after this segment. */
  commentsEndingHere: Annotation[]
}

function buildSegments(paragraph: Paragraph, annotations: Annotation[]): Segment[] {
  const { id, text } = paragraph
  const local = annotations.flatMap((a) =>
    a.ranges
      .filter((r) => r.paragraphId === id)
      .map((r) => ({ annotation: a, start: Math.max(0, r.start), end: Math.min(text.length, r.end) })),
  )
  const points = [...new Set([0, text.length, ...local.flatMap((l) => [l.start, l.end])])].sort(
    (a, b) => a - b,
  )

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
      return a.kind === 'comment' && last?.paragraphId === id && Math.min(text.length, last.end) === end
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
  onMarksClick,
  onCommentClick,
}: Props) {
  const segments = useMemo(() => buildSegments(paragraph, annotations), [paragraph, annotations])
  const Text = paragraph.isHeading ? 'h3' : 'p'

  function handleMarkClick(event: MouseEvent, covering: Annotation[]) {
    if (hasTextSelection()) return
    const anchor = anchorFromPoint(event.clientX, event.clientY)
    const marks = covering.filter((a) => a.kind !== 'comment')
    if (marks.length > 0) onMarksClick(marks.map((a) => a.id), anchor)
    else onCommentClick(covering[0].id, anchor)
  }

  return (
    <div className={`paragraph${paragraph.isHeading ? ' heading' : ''}`}>
      <Text className="paragraph-text" data-paragraph-id={paragraph.id}>
        {segments.map((segment) => {
          const text = paragraph.text.slice(segment.start, segment.end)
          const { covering } = segment
          return (
            <span key={segment.start}>
              {covering.length === 0 ? (
                text
              ) : (
                <span
                  className={`mark${covering.some((a) => a.kind === 'comment') ? ' commented' : ''}`}
                  style={segmentStyle(covering)}
                  onClick={(e) => handleMarkClick(e, covering)}
                >
                  {text}
                </span>
              )}
              {segment.commentsEndingHere.map((comment) => (
                <button
                  key={comment.id}
                  type="button"
                  className="comment-bubble"
                  aria-label="查看评论"
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
