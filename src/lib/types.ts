import type { Paragraph } from '../pdf/extractParagraphs'
import type { TocEntry } from './toc'

export type Book = {
  /** SHA-256 of the PDF bytes, so the same file always maps to the same book. */
  id: string
  fileName: string
  title: string
  author: string
  description: string
  numPages: number
  paragraphs: Paragraph[]
  /** Chapters parsed from the contents page. Empty when the paper has none. */
  toc?: TocEntry[]
  /** Printed page minus PDF page. 0 until a contents page can be matched to headings. */
  pageOffset?: number
  addedAt: number
  lastReadAt: number | null
  currentPage: number
  /** Set when the cloud knows this file but this browser does not have the PDF yet. */
  needsFile?: boolean
  /** When progress or book metadata last changed. Used to merge devices. */
  updatedAt?: number
  /** One folder, or none. */
  folderId?: string | null
  tagIds?: string[]
  /** Publication year, when the reader has set one. */
  year?: number | null
  /** When the folder, tags, or year last changed. Kept apart from reading progress. */
  classifyUpdatedAt?: number
}

export type Folder = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export const TAG_COLORS = ['yellow', 'green', 'pink', 'blue', 'orange', 'purple'] as const
export type TagColor = (typeof TAG_COLORS)[number]

export type Tag = {
  id: string
  name: string
  color: TagColor
  createdAt: number
  updatedAt: number
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
