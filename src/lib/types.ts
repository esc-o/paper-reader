import type { Paragraph } from '../pdf/extractParagraphs'

export type Book = {
  /** SHA-256 of the PDF bytes, so the same file always maps to the same book. */
  id: string
  fileName: string
  title: string
  author: string
  description: string
  numPages: number
  paragraphs: Paragraph[]
  addedAt: number
  lastReadAt: number | null
  currentPage: number
}

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'pink', 'blue'] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

export const COLOR_NAMES: Record<HighlightColor, string> = {
  yellow: '黄色',
  green: '绿色',
  pink: '粉色',
  blue: '蓝色',
}

export type AnnotationKind = 'highlight' | 'underline' | 'comment'

/** Character offsets into `Paragraph.text`; `end` is exclusive. */
export type TextRange = {
  paragraphId: number
  start: number
  end: number
}

export type Annotation = {
  id: string
  bookId: string
  page: number
  ranges: TextRange[]
  text: string
  kind: AnnotationKind
  color?: HighlightColor
  comment?: string
  createdAt: number
  updatedAt: number
}
