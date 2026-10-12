import { getDocument, GlobalWorkerOptions, PasswordException } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export type Paragraph = {
  id: number
  text: string
  startPage: number
  endPage: number
}

type Line = {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export class ExtractionError extends Error {}

export async function extractParagraphs(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<Paragraph[]> {
  const data = new Uint8Array(await file.arrayBuffer())

  const loadingTask = getDocument({ data })
  let pdf
  try {
    pdf = await loadingTask.promise
  } catch (error) {
    if (error instanceof PasswordException) {
      throw new ExtractionError('这个 PDF 有密码保护，暂时不支持。')
    }
    throw new ExtractionError('这个文件打不开，可能不是有效的 PDF。')
  }

  const result: Paragraph[] = []
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      onProgress?.(pageNumber, pdf.numPages)
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const items = content.items.filter((item): item is TextItem => 'str' in item)

      paragraphsOnPage(linesFrom(items)).forEach((text, i) => {
        const last = result.at(-1)
        // A paragraph that didn't finish on the previous page continues here.
        if (i === 0 && last && last.endPage === pageNumber - 1 && !endsSentence(last.text)) {
          last.text = join(last.text, text)
          last.endPage = pageNumber
        } else {
          result.push({ id: result.length, text, startPage: pageNumber, endPage: pageNumber })
        }
      })
      page.cleanup()
    }
  } finally {
    await loadingTask.destroy()
  }

  if (result.length === 0) {
    throw new ExtractionError('没有找到可提取的文字。它可能是扫描版（图片）PDF。')
  }
  return result
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

function paragraphsOnPage(lines: Line[]): string[] {
  if (lines.length === 0) return []

  const lineHeight = median(lines.map((l) => l.height))
  const lineWidth = median(lines.map((l) => l.width))
  const lineSpacing = median(
    lines
      .slice(1)
      .map((line, i) => lines[i].y - line.y)
      .filter((d) => d > 0 && d < lineHeight * 3),
  ) || lineHeight * 1.2

  const paragraphs: string[] = []
  let current = lines[0].text
  for (let i = 1; i < lines.length; i++) {
    if (startsNewParagraph(lines[i], lines[i - 1], lineHeight, lineWidth, lineSpacing)) {
      paragraphs.push(current)
      current = lines[i].text
    } else {
      current = join(current, lines[i].text)
    }
  }
  paragraphs.push(current)
  return paragraphs
}

// PDF page coordinates have their origin at the bottom-left, so lines further down have smaller y.
function startsNewParagraph(
  line: Line,
  previous: Line,
  lineHeight: number,
  lineWidth: number,
  lineSpacing: number,
): boolean {
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
  if ('-\u00AD‐'.includes(last) && /\p{Ll}/u.test(first)) return a.slice(0, -1) + b
  if (isCJK(last) || isCJK(first)) return a + b
  return a + ' ' + b
}

function endsSentence(text: string): boolean {
  const trimmed = text.replace(/["”’')）]+$/, '')
  const last = trimmed.at(-1)
  return !last || '.!?:;。！？：；'.includes(last)
}

function isPageNumber(text: string): boolean {
  return /^\d{1,4}$/.test(text)
}

function isCJK(char: string): boolean {
  return /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/.test(char)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]
}
