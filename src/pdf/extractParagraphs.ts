import { getDocument, GlobalWorkerOptions, PasswordException } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import i18n from '../i18n'
import { finalizeParagraphs, parseTocLine } from '../lib/toc'
import type { TocEntry } from '../lib/toc'
import { dropRepeatedFigures, figuresOnPage } from './figures'
import type { PageFigure } from './figures'

GlobalWorkerOptions.workerSrc = workerUrl

export type Paragraph = {
  id: number
  text: string
  startPage: number
  endPage: number
  isHeading: boolean
  /** A contents-page line. Kept for the chapter list, hidden while reading. */
  isToc?: boolean
  /** Illustration copied from the PDF, shown at its own aspect ratio. */
  image?: string
  imageWidth?: number
  imageHeight?: number
}

/** Bump when extraction changes, so dropping the same file in again rebuilds the text. */
export const TEXT_VERSION = 3

export type ExtractedPdf = {
  title: string
  author: string
  numPages: number
  paragraphs: Paragraph[]
  toc: TocEntry[]
  pageOffset: number
}

type Line = {
  text: string
  x: number
  y: number
  width: number
  height: number
}

type RawPage = {
  pageNumber: number
  width: number
  height: number
  lines: Line[]
  figures: PageFigure[]
}

type Block = {
  text: string
  isHeading: boolean
  image?: string
  imageWidth?: number
  imageHeight?: number
}

export class ExtractionError extends Error {}

export async function extractPdf(
  data: Uint8Array,
  onProgress?: (page: number, total: number) => void,
): Promise<ExtractedPdf> {
  const loadingTask = getDocument({ data })
  let pdf
  try {
    pdf = await loadingTask.promise
  } catch (error) {
    if (error instanceof PasswordException) {
      throw new ExtractionError(i18n.t('errors.password'))
    }
    throw new ExtractionError(i18n.t('errors.invalid'))
  }

  const paragraphs: Paragraph[] = []
  let fontTitle = ''
  let info: Record<string, unknown> = {}
  try {
    info = ((await pdf.getMetadata()).info ?? {}) as Record<string, unknown>

    const pages: RawPage[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      onProgress?.(pageNumber, pdf.numPages)
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const items = content.items.filter((item): item is TextItem => 'str' in item)
      const figures = await figuresOnPage(page, viewport.width, viewport.height)
      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        lines: linesFrom(items),
        figures,
      })
      page.cleanup()
    }

    removeMargins(pages)
    dropRepeatedFigures(pages)
    fontTitle = titleFromLines(pages[0]?.lines ?? [])

    for (const raw of pages) {
      let continued = false
      for (const block of blocksOnPage(raw.lines, raw.figures, raw.width)) {
        const last = paragraphs.at(-1)
        if (
          !continued &&
          !block.image &&
          last &&
          !last.image &&
          last.endPage === raw.pageNumber - 1 &&
          !last.isHeading &&
          !isHeadingText(block.text) &&
          !parseTocLine(block.text) &&
          !parseTocLine(last.text) &&
          !endsSentence(last.text)
        ) {
          last.text = join(last.text, block.text)
          last.endPage = raw.pageNumber
        } else {
          paragraphs.push({
            id: paragraphs.length,
            text: block.text,
            startPage: raw.pageNumber,
            endPage: raw.pageNumber,
            isHeading: block.isHeading,
            image: block.image,
            imageWidth: block.imageWidth,
            imageHeight: block.imageHeight,
          })
        }
        continued = true
      }
    }
  } finally {
    await loadingTask.destroy()
  }

  if (paragraphs.length === 0) {
    throw new ExtractionError(i18n.t('errors.noText'))
  }

  const metaTitle = typeof info.Title === 'string' ? info.Title.trim() : ''
  const author = typeof info.Author === 'string' ? info.Author.trim() : ''
  const reading = finalizeParagraphs(paragraphs, pdf.numPages)
  return {
    title: isUsableMetaTitle(metaTitle) ? metaTitle : fontTitle,
    author,
    numPages: pdf.numPages,
    paragraphs: reading.paragraphs,
    toc: reading.toc,
    pageOffset: reading.pageOffset,
  }
}

export function isHeadingText(text: string): boolean {
  if (parseTocLine(text) || text.length > 80 || /[.:;,]$/.test(text)) return false
  return NAMED_HEADING.test(text) || NUMBERED_HEADING.test(text)
}

const NAMED_HEADING =
  /^(abstract|introduction|related work|background|methods?|methodology|experiments?|results|discussion|conclusions?|references|bibliography|acknowledge?ments?|appendix\b.*)$/i
const NUMBERED_HEADING = /^(\d+(\.\d+)*\.?|[IVX]+\.|[A-H](\.\d+)+|[A-H]\.)\s+\p{Lu}/u

function isUsableMetaTitle(title: string): boolean {
  return (
    title.length >= 6 &&
    !/\.(pdf|docx?|dvi|tex)$/i.test(title) &&
    !/^(microsoft word|untitled)/i.test(title)
  )
}

// The title is usually the run of lines set in the largest font on the first page.
function titleFromLines(lines: Line[]): string {
  const candidates = lines.filter((l) => l.text.length > 3)
  if (candidates.length === 0) return ''
  const largest = Math.max(...candidates.map((l) => l.height))
  if (largest < median(lines.map((l) => l.height)) * 1.3) return ''

  const start = lines.findIndex((l) => l.height >= largest * 0.95 && l.text.length > 3)
  let title = lines[start].text
  for (let i = start + 1; i < lines.length && lines[i].height >= largest * 0.95; i++) {
    title = join(title, lines[i].text)
  }
  return title.length <= 200 ? title : ''
}

function linesFrom(items: TextItem[]): Line[] {
  const lines: Line[] = []
  let current: { text: string; x: number; y: number; right: number; height: number } | null = null

  const finish = () => {
    if (!current) return
    const text = current.text.replace(/\s+/g, ' ').trim()
    if (text && !isPageNumber(text)) {
      lines.push({
        text,
        x: current.x,
        y: current.y,
        width: current.right - current.x,
        height: current.height,
      })
    }
    current = null
  }

  for (const item of items) {
    // Rotated text is margin stamps (like arXiv's sidebar), not body text.
    if (Math.abs(item.transform[1]) > 0.01 || Math.abs(item.transform[2]) > 0.01) continue
    const x: number = item.transform[4]
    const y: number = item.transform[5]
    const height = item.height || Math.abs(item.transform[3]) || 10

    if (current && Math.abs(y - current.y) > Math.max(height, current.height) * 0.5) finish()

    if (item.str) {
      if (!current) {
        current = { text: item.str, x, y, right: x + item.width, height }
      } else {
        const gap = x - current.right
        const needsSpace =
          gap > height * 0.15 && !/\s$/.test(current.text) && !/^\s/.test(item.str)
        current.text += (needsSpace ? ' ' : '') + item.str
        current.x = Math.min(current.x, x)
        current.right = Math.max(current.right, x + item.width)
        current.height = Math.max(current.height, height)
      }
    }

    if (item.hasEOL) finish()
  }
  finish()
  return lines
}

function blocksOnPage(lines: Line[], figures: PageFigure[], pageWidth: number): Block[] {
  const twoColumns = hasTwoColumns(lines, pageWidth)
  const columnOf = (x: number) => (twoColumns && x >= pageWidth * 0.5 ? 1 : 0)
  type Node =
    | { kind: 'line'; line: Line; column: number; top: number; x: number }
    | { kind: 'figure'; figure: PageFigure; column: number; top: number; x: number }
  const nodes: Node[] = [
    ...lines.map((line) => ({ kind: 'line' as const, line, column: columnOf(line.x), top: line.y, x: line.x })),
    ...figures.map((figure) => ({
      kind: 'figure' as const,
      figure,
      column: columnOf(figure.x),
      top: figure.top,
      x: figure.x,
    })),
  ]
  nodes.sort((a, b) => a.column - b.column || b.top - a.top || a.x - b.x)

  const metrics = lineMetrics(lines)
  const blocks: Block[] = []
  let text: string | null = null
  let previous: Line | null = null
  const flush = () => {
    if (!text) return
    blocks.push({ text, isHeading: isHeadingText(text) })
    text = null
  }

  for (const node of nodes) {
    if (node.kind === 'figure') {
      flush()
      previous = null
      blocks.push({
        text: '',
        isHeading: false,
        image: node.figure.src,
        imageWidth: node.figure.width,
        imageHeight: node.figure.height,
      })
      continue
    }
    const line = node.line
    if (!text || !previous || startsNewParagraph(line, previous, metrics.height, metrics.width, metrics.spacing)) {
      flush()
      text = line.text
    } else {
      text = join(text, line.text)
    }
    previous = line
  }
  flush()
  return blocks
}

function hasTwoColumns(lines: Line[], pageWidth: number): boolean {
  if (lines.length < 8) return false
  const left = lines.filter((line) => line.x < pageWidth * 0.42).length
  const right = lines.filter((line) => line.x > pageWidth * 0.58).length
  return left >= 4 && right >= 4
}

function lineMetrics(lines: Line[]): { height: number; width: number; spacing: number } {
  const height = median(lines.map((line) => line.height)) || 12
  const width = median(lines.map((line) => line.width)) || 1
  const spacing =
    median(
      lines
        .slice(1)
        .map((line, index) => lines[index].y - line.y)
        .filter((gap) => gap > 0 && gap < height * 3),
    ) || height * 1.2
  return { height, width, spacing }
}

function removeMargins(pages: RawPage[]): void {
  const edgeCounts = new Map<string, Set<number>>()
  const edgeLines = new Set<Line>()
  for (const page of pages) {
    const sorted = [...page.lines].sort((a, b) => b.y - a.y)
    const edges = [...sorted.slice(0, 3), ...sorted.slice(-3)]
    for (const line of edges) {
      edgeLines.add(line)
      const key = runningKey(line.text)
      if (key.length < 8) continue
      const seen = edgeCounts.get(key) ?? new Set<number>()
      seen.add(page.pageNumber)
      edgeCounts.set(key, seen)
    }
  }
  const repeated = pages.length <= 2 ? 2 : 3

  for (const page of pages) {
    const separated = linesOutsideBody(page.lines, page.height)
    const bodyHeight = median(page.lines.map((line) => line.height)) || 12
    page.lines = page.lines.filter((line) => {
      if (isMarginBoilerplate(line.text)) return false
      if (line.height > bodyHeight * 1.35) return true
      const key = runningKey(line.text)
      const seen = key.length >= 8 ? (edgeCounts.get(key)?.size ?? 0) : 0
      const running = seen >= repeated && line.text.length < 160
      if (running && (edgeLines.has(line) || marginZone(line, page.height))) return false
      if (isHeadingText(line.text)) return true
      if (separated.has(line)) return false
      return true
    })
  }
}

function marginZone(line: Line, pageHeight: number): 'top' | 'bottom' | null {
  if (line.y >= pageHeight * 0.8) return 'top'
  if (line.y <= pageHeight * 0.2) return 'bottom'
  return null
}

function runningKey(text: string): string {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
}

function isMarginBoilerplate(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 320) return false
  if (/\bdownloaded from\b/i.test(trimmed) && /https?:\/\//i.test(trimmed)) return true
  if (/\bdoi\s*:?\s*10\.\d/i.test(trimmed) && /\bcopyright\b/i.test(trimmed)) return true
  return (
    /^https?:\/\//i.test(trimmed) ||
    /^copyright\b/i.test(trimmed) ||
    /^©/.test(trimmed) ||
    /\ball rights reserved\b/i.test(trimmed)
  )
}

/** Lines pulled away from the body at the top or bottom of the page. */
function linesOutsideBody(lines: Line[], pageHeight: number): Set<Line> {
  const drop = new Set<Line>()
  if (lines.length < 2) return drop
  const sorted = [...lines].sort((a, b) => b.y - a.y)
  const height = median(sorted.map((line) => line.height)) || 12
  const gaps: number[] = []
  for (let index = 1; index < sorted.length; index++) {
    const gap = sorted[index - 1].y - sorted[index].y
    if (gap > height * 0.6 && gap < height * 3) gaps.push(gap)
  }
  const spacing = median(gaps) || height * 1.2

  for (let index = 0; index < sorted.length - 1; index++) {
    const line = sorted[index]
    if (line.y < pageHeight * 0.8) break
    if (line.height > height * 1.35 || isHeadingText(line.text)) break
    const gap = line.y - sorted[index + 1].y
    if (gap > spacing * 1.6) drop.add(line)
    else break
  }

  for (let index = sorted.length - 1; index > 0; index--) {
    const line = sorted[index]
    if (line.y > pageHeight * 0.2) break
    if (line.height > height * 1.35 || isHeadingText(line.text)) break
    const gap = sorted[index - 1].y - line.y
    if (gap > spacing * 1.6) drop.add(line)
    else break
  }
  return drop
}

// PDF page coordinates have their origin at the bottom-left, so lines further down have smaller y.
function startsNewParagraph(
  line: Line,
  previous: Line,
  lineHeight: number,
  lineWidth: number,
  lineSpacing: number,
): boolean {
  if (parseTocLine(line.text) || parseTocLine(previous.text)) return true

  const isHeadingLine = (l: Line) => l.width < lineWidth * 0.7 && isHeadingText(l.text)
  if (isHeadingLine(line) || isHeadingLine(previous)) return true

  const previousIsShort = previous.width < lineWidth * 0.8
  const previousEndsSentence = endsSentence(previous.text)

  const jumpedToNextColumn = line.y > previous.y + lineHeight * 0.5
  if (jumpedToNextColumn) return previousIsShort && previousEndsSentence

  if (previous.y - line.y > lineSpacing * 1.4) return true

  const isIndented = line.x - previous.x > lineHeight * 0.8
  if (isIndented) return true

  return previousIsShort && previousEndsSentence
}

function join(a: string, b: string): string {
  const last = a.at(-1)
  const first = b.at(0)
  if (!last || !first) return a + b
  if ('-\u00AD‐'.includes(last) && /\p{Ll}/u.test(first)) {
    // "English-" + "to-German" is a real compound; "trans-" + "lation" is a split word.
    const keepHyphen = last !== '\u00AD' && /(^|\s)\p{Lu}\S*.$/u.test(a)
    return keepHyphen ? a + b : a.slice(0, -1) + b
  }
  if (isCJK(last) || isCJK(first)) return a + b
  return a + ' ' + b
}

function endsSentence(text: string): boolean {
  const trimmed = text.replace(/["”’')）]+$/, '')
  const last = trimmed.at(-1)
  return !last || '.!?:;。！？：；'.includes(last)
}

function isPageNumber(text: string): boolean {
  const trimmed = text.trim()
  return (
    /^\d{1,4}$/.test(trimmed) ||
    /^[-–—]\s*\d{1,4}\s*[-–—]$/.test(trimmed) ||
    /^\d{1,4}\s*[/|]\s*\d{1,4}$/.test(trimmed) ||
    /^(?:page|p\.?|pp\.?)\s*\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i.test(trimmed)
  )
}

function isCJK(char: string): boolean {
  return /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/.test(char)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]
}
