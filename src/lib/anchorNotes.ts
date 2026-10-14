import type { Paragraph } from '../pdf/extractParagraphs'
import type { Annotation, TextRange } from './types'

type CharRef = { paragraphId: number; offset: number } | null

type Hit = { ranges: TextRange[]; page: number }

/** Moves each note onto the words it quoted, when a rebuild has shifted paragraph offsets. */
export function relocateAnnotations(annotations: Annotation[], paragraphs: Paragraph[]): Annotation[] {
  return annotations.map((annotation) => relocateAnnotation(annotation, paragraphs))
}

export async function anchorAnnotations(paragraphs: Paragraph[], annotations: Annotation[]): Promise<Annotation[]> {
  const next = relocateAnnotations(annotations, paragraphs)
  const changed = next.filter((annotation, index) => !samePlace(annotation, annotations[index]))
  if (changed.length > 0) {
    const { putAnnotations } = await import('./db')
    await putAnnotations(changed)
  }
  return next
}

function relocateAnnotation(annotation: Annotation, paragraphs: Paragraph[]): Annotation {
  const quote = collapse(annotation.text)
  if (!quote || paragraphs.length === 0) return annotation
  if (sameQuote(textAt(annotation, paragraphs), quote)) return annotation

  const { norm, map, pages } = indexParagraphs(paragraphs)
  const hits = findHits(norm, map, pages, quote)
  if (hits.length === 0) return annotation

  const hinted = annotation.ranges.map((range) => range.paragraphId)
  const hintStillHasQuote = hinted.some((id) => {
    const paragraph = paragraphs.find((item) => item.id === id)
    return paragraph ? collapse(paragraph.text).includes(quote) : false
  })
  hits.sort((a, b) => score(a, annotation, hintStillHasQuote) - score(b, annotation, hintStillHasQuote))
  const hit = hits[0]
  if (samePlace({ ...annotation, ranges: hit.ranges, page: hit.page }, annotation)) return annotation
  return { ...annotation, ranges: hit.ranges, page: hit.page }
}

function score(hit: Hit, annotation: Annotation, hintStillHasQuote: boolean): number {
  let value = Math.abs(hit.page - annotation.page) * 1_000_000
  if (!hintStillHasQuote) return value
  const hinted = annotation.ranges
  const idDist = Math.min(...hit.ranges.map((range) => Math.min(...hinted.map((item) => Math.abs(item.paragraphId - range.paragraphId)))))
  value += idDist * 1_000
  const startDist = Math.min(
    ...hit.ranges.map((range) =>
      Math.min(...hinted.map((item) => (item.paragraphId === range.paragraphId ? Math.abs(item.start - range.start) : 100_000))),
    ),
  )
  return value + startDist
}

function findHits(norm: string, map: CharRef[], pages: Map<number, number>, quote: string): Hit[] {
  const starts = quote.includes(' ') ? indexOfAll(norm, quote) : indexOfWord(norm, quote)
  const hits: Hit[] = []
  for (const start of starts) {
    const ranges = rangesFrom(map, start, start + quote.length)
    if (ranges.length === 0) continue
    const page = pages.get(ranges[0].paragraphId) ?? 1
    hits.push({ ranges, page })
  }
  return hits
}

function indexOfAll(text: string, quote: string): number[] {
  const found: number[] = []
  let from = 0
  while (from <= text.length) {
    const at = text.indexOf(quote, from)
    if (at < 0) break
    found.push(at)
    from = at + 1
  }
  return found
}

function indexOfWord(text: string, quote: string): number[] {
  const found: number[] = []
  const pattern = new RegExp(`(?:^| )${escapeRegExp(quote)}(?![\\p{L}\\p{N}])`, 'gu')
  for (const match of text.matchAll(pattern)) {
    if (match.index == null) continue
    found.push(match.index + (text[match.index] === ' ' ? 1 : 0))
  }
  return found
}

function indexParagraphs(paragraphs: Paragraph[]): { norm: string; map: CharRef[]; pages: Map<number, number> } {
  let norm = ''
  const map: CharRef[] = []
  const pages = new Map<number, number>()
  for (const paragraph of paragraphs) {
    pages.set(paragraph.id, paragraph.startPage)
    if (!paragraph.text) continue
    const piece = normalizeWithMap(paragraph.text)
    if (norm.length > 0 && piece.norm.length > 0) {
      norm += ' '
      map.push(null)
    }
    for (let index = 0; index < piece.norm.length; index++) {
      if (piece.norm[index] === ' ' && norm.endsWith(' ')) continue
      norm += piece.norm[index]
      map.push({ paragraphId: paragraph.id, offset: piece.map[index] })
    }
  }
  return { norm, map, pages }
}

function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = ''
  const map: number[] = []
  let pendingSpace = false
  for (let index = 0; index < text.length; index++) {
    if (/\s/.test(text[index])) {
      pendingSpace = norm.length > 0
      continue
    }
    if (pendingSpace) {
      norm += ' '
      map.push(index)
      pendingSpace = false
    }
    norm += text[index]
    map.push(index)
  }
  return { norm, map }
}

function rangesFrom(map: CharRef[], start: number, end: number): TextRange[] {
  const ranges: TextRange[] = []
  for (let index = start; index < end; index++) {
    const ref = map[index]
    if (!ref) continue
    const last = ranges.at(-1)
    if (last && last.paragraphId === ref.paragraphId && ref.offset >= last.start) {
      last.end = Math.max(last.end, ref.offset + 1)
      continue
    }
    ranges.push({ paragraphId: ref.paragraphId, start: ref.offset, end: ref.offset + 1 })
  }
  return ranges
}

function textAt(annotation: Annotation, paragraphs: Paragraph[]): string {
  const byId = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]))
  return annotation.ranges.map((range) => byId.get(range.paragraphId)?.text.slice(range.start, range.end) ?? '').join(' ')
}

function sameQuote(text: string, quote: string): boolean {
  return collapse(text) === quote
}

function samePlace(left: Annotation, right: Annotation): boolean {
  return left.page === right.page && JSON.stringify(left.ranges) === JSON.stringify(right.ranges)
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
