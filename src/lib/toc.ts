export type TocEntry = {
  title: string
  /** Page number printed in the book. */
  bookPage: number
  /** PDF page this chapter starts on. */
  pdfPage: number
  level: number
}

export type TocParagraph = {
  id: number
  text: string
  startPage: number
  endPage: number
  isHeading: boolean
  isToc?: boolean
}

const LEADER = /^(.*?)\s*(?:[.\u00B7\u2022\u2024\u2026\u22EF_]\s*){2,}(\d{1,4})\s*$/

/** "5.1. Graphical Fidelity......16" → title + the page number printed in the book. */
export function parseTocLine(text: string): { title: string; bookPage: number } | null {
  const match = text.replace(/\s+/g, ' ').trim().match(LEADER)
  if (!match) return null
  const title = match[1].trim()
  const bookPage = Number(match[2])
  if (title.length < 2 || title.length > 140 || !bookPage || /^\d+$/.test(title)) return null
  return { title, bookPage }
}

/** A page of leader-dot lines is a table of contents, not body text. */
export function isTocPage(lines: string[]): boolean {
  const useful = lines.map((line) => line.trim()).filter(Boolean)
  if (useful.length < 2) return false
  const hits = useful.filter((line) => parseTocLine(line)).length
  if (hits < 2) return false
  const ratio = hits / useful.length
  return (hits >= 3 && ratio >= 0.45) || ratio >= 0.6
}

export function tocLevel(title: string): number {
  const match = title.match(/^(\d+(?:\.\d+)*)\b/)
  return match ? match[1].split('.').length : 1
}

/** Printed page when it falls inside the book; front matter keeps the PDF page. */
export function displayPage(pdfPage: number, pageOffset = 0): number {
  const printed = pdfPage + pageOffset
  return printed >= 1 ? printed : pdfPage
}

function norm(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Marks contents-page paragraphs, and turns leader-dot lines into chapter entries.
 * `pageOffset` is printed page minus PDF page, learned by matching entries to headings.
 */
export function finalizeParagraphs<T extends TocParagraph>(
  paragraphs: T[],
  numPages?: number,
): { paragraphs: T[]; toc: TocEntry[]; pageOffset: number } {
  const byPage = new Map<number, T[]>()
  for (const paragraph of paragraphs) {
    byPage.set(paragraph.startPage, [...(byPage.get(paragraph.startPage) ?? []), paragraph])
  }
  const tocPages = new Set<number>()
  for (const [page, list] of byPage) {
    if (isTocPage(list.map((paragraph) => paragraph.text))) tocPages.add(page)
  }

  const next = paragraphs.map((paragraph) => {
    const isToc = tocPages.has(paragraph.startPage) || parseTocLine(paragraph.text) !== null
    return { ...paragraph, isToc, isHeading: isToc ? false : paragraph.isHeading }
  })

  const headings = next.filter((paragraph) => paragraph.isHeading)
  const raw = next.flatMap((paragraph) => {
    if (!paragraph.isToc) return []
    const entry = parseTocLine(paragraph.text)
    return entry ? [{ ...entry, level: tocLevel(entry.title) }] : []
  })

  const diffs: number[] = []
  const located = raw.map((entry) => {
    const heading = matchHeading(entry.title, headings)
    if (heading) diffs.push(entry.bookPage - heading.startPage)
    return { ...entry, pdfPage: heading?.startPage ?? 0 }
  })
  const pageOffset = median(diffs)
  const lastPage = numPages ?? next.reduce((max, paragraph) => Math.max(max, paragraph.endPage), 1)

  const toc = located.map((entry) => ({
    ...entry,
    pdfPage: entry.pdfPage || clamp(entry.bookPage - pageOffset, 1, lastPage),
  }))
  return { paragraphs: next, toc, pageOffset }
}

function matchHeading<T extends TocParagraph>(title: string, headings: T[]): T | undefined {
  const wanted = norm(title)
  if (!wanted) return undefined
  return (
    headings.find((heading) => norm(heading.text) === wanted) ??
    headings.find((heading) => {
      const have = norm(heading.text)
      return wanted.length > 10 && have.length > 10 && (have.includes(wanted) || wanted.includes(have))
    })
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
