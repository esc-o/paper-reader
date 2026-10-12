import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph as DocxParagraph,
  ShadingType,
  TextRun,
  UnderlineType,
} from 'docx'
import type { Paragraph } from '../pdf/extractParagraphs'
import { prepareBook } from './library'
import { displayPage } from './toc'
import type { Annotation, Book, HighlightColor } from './types'

export class ExportError extends Error {}

export type ExportOptions = {
  /** Ignore the other filters and export every note. */
  all: boolean
  commentsOnly: boolean
  colors: HighlightColor[]
}

const FILLS: Record<HighlightColor, string> = {
  yellow: 'FFD43B',
  green: '69DB7C',
  pink: 'F783AC',
  blue: '74C0FC',
}

const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Microsoft YaHei' }

type QuoteRun = { text: string; color?: HighlightColor; underline: boolean }

type NoteEntry = {
  pdfPage: number
  paragraphId: number
  pageLabel: string
  chapter: string
  runs: QuoteRun[]
  comments: string[]
}

export async function exportNotes(book: Book, annotations: Annotation[], options: ExportOptions): Promise<void> {
  const prepared = prepareBook(book).book
  const notes = collectNotes(prepared, annotations, options)
  if (notes.length === 0) throw new ExportError('没有符合条件的标注。')

  const children: DocxParagraph[] = [
    new DocxParagraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 80 },
      children: [run(prepared.title || prepared.fileName)],
    }),
    new DocxParagraph({
      spacing: { after: 360 },
      children: [run(formatDate(new Date()), { size: 18, color: '7A706B' })],
    }),
  ]

  let chapter = ''
  for (const note of notes) {
    if (note.chapter && note.chapter !== chapter) {
      chapter = note.chapter
      children.push(
        new DocxParagraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 280, after: 120 },
          children: [run(chapter)],
        }),
      )
    }
    children.push(
      new DocxParagraph({
        spacing: { after: note.comments.length > 0 ? 40 : 200 },
        children: [
          run('“'),
          ...note.runs.map((part) =>
            run(part.text, {
              underline: part.underline ? { type: UnderlineType.SINGLE } : undefined,
              shading: part.color ? { type: ShadingType.CLEAR, fill: FILLS[part.color] } : undefined,
            }),
          ),
          run(`”（${note.pageLabel}）`),
        ],
      }),
    )
    note.comments.forEach((comment, index) => {
      const last = index === note.comments.length - 1
      children.push(
        new DocxParagraph({
          spacing: { after: last ? 200 : 40 },
          children: [run(`　评：${comment}`)],
        }),
      )
    })
  }

  const blob = await Packer.toBlob(new Document({ sections: [{ children }] }))
  download(blob, fileName(prepared.title || prepared.fileName))
}

function collectNotes(book: Book, annotations: Annotation[], options: ExportOptions): NoteEntry[] {
  const byParagraph = new Map<number, Annotation[]>()
  for (const annotation of annotations) {
    for (const paragraphId of new Set(annotation.ranges.map((range) => range.paragraphId))) {
      byParagraph.set(paragraphId, [...(byParagraph.get(paragraphId) ?? []), annotation])
    }
  }

  const offset = book.pageOffset ?? 0
  const notes: NoteEntry[] = []
  for (const paragraph of book.paragraphs) {
    const group = byParagraph.get(paragraph.id)
    if (!group || !passes(group, options)) continue
    const runs = quoteRuns(paragraph, group)
    if (runs.length === 0) continue
    const start = displayPage(paragraph.startPage, offset)
    const end = displayPage(paragraph.endPage, offset)
    notes.push({
      pdfPage: paragraph.startPage,
      paragraphId: paragraph.id,
      pageLabel: start === end ? `p. ${start}` : `p. ${start}–${end}`,
      chapter: chapterAt(book, paragraph),
      runs,
      comments: group.flatMap((annotation) =>
        annotation.kind === 'comment' && annotation.comment?.trim() ? [annotation.comment.trim()] : [],
      ),
    })
  }
  return notes.sort((a, b) => a.pdfPage - b.pdfPage || a.paragraphId - b.paragraphId)
}

function passes(group: Annotation[], options: ExportOptions): boolean {
  if (options.all) return true
  const wantsComments = options.commentsOnly
  const wantsColors = options.colors.length > 0
  if (!wantsComments && !wantsColors) return false
  const commentOk = !wantsComments || group.some((annotation) => annotation.kind === 'comment' && annotation.comment?.trim())
  const colorOk =
    !wantsColors ||
    group.some(
      (annotation) =>
        annotation.kind === 'highlight' && annotation.color !== undefined && options.colors.includes(annotation.color),
    )
  return commentOk && colorOk
}

function quoteRuns(paragraph: Paragraph, group: Annotation[]): QuoteRun[] {
  const ranges = group.flatMap((annotation) =>
    annotation.ranges.filter((range) => range.paragraphId === paragraph.id && range.end > range.start),
  )
  if (ranges.length === 0) return []
  const start = Math.max(0, Math.min(...ranges.map((range) => range.start)))
  const end = Math.min(paragraph.text.length, Math.max(...ranges.map((range) => range.end)))
  const runs: QuoteRun[] = []
  let buffer = ''
  let style = marksAt(start, paragraph.id, group)
  const flush = () => {
    if (!buffer) return
    runs.push({ text: buffer, ...style })
    buffer = ''
  }
  for (let index = start; index < end; index++) {
    const next = marksAt(index, paragraph.id, group)
    if (buffer && (next.color !== style.color || next.underline !== style.underline)) {
      flush()
      style = next
    }
    buffer += paragraph.text[index]
  }
  flush()
  if (runs[0]) runs[0] = { ...runs[0], text: runs[0].text.trimStart() }
  const last = runs.at(-1)
  if (last) runs[runs.length - 1] = { ...last, text: last.text.trimEnd() }
  return runs.filter((part) => part.text)
}

function marksAt(index: number, paragraphId: number, group: Annotation[]): { color?: HighlightColor; underline: boolean } {
  let color: HighlightColor | undefined
  let underline = false
  for (const annotation of group) {
    const covers = annotation.ranges.some(
      (range) => range.paragraphId === paragraphId && index >= range.start && index < range.end,
    )
    if (!covers) continue
    if (annotation.kind === 'highlight' && annotation.color) color = annotation.color
    if (annotation.kind === 'underline') underline = true
  }
  return { color, underline }
}

function chapterAt(book: Book, paragraph: Paragraph): string {
  const toc = book.toc ?? []
  if (toc.length > 0) {
    let name = ''
    for (const entry of toc) {
      if (entry.pdfPage > paragraph.startPage) break
      name = entry.title
    }
    return name
  }
  let name = ''
  for (const heading of book.paragraphs) {
    if (!heading.isHeading || heading.isToc) continue
    if (heading.startPage > paragraph.startPage || heading.id > paragraph.id) break
    name = heading.text
  }
  return name
}

function run(
  text: string,
  extra: { size?: number; color?: string; underline?: { type: (typeof UnderlineType)[keyof typeof UnderlineType] }; shading?: { type: (typeof ShadingType)[keyof typeof ShadingType]; fill: string } } = {},
): TextRun {
  return new TextRun({ text, font: FONT, ...extra })
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function fileName(title: string): string {
  const date = new Date()
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const safe = title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'notes'
  return `${safe}_notes_${stamp}.docx`
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}
