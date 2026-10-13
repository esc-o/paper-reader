import { useState } from 'react'
import i18n from '../i18n'
import { extractPdf, ExtractionError } from '../pdf/extractParagraphs'
import type { Paragraph } from '../pdf/extractParagraphs'
import { authorsForDoi, doiInText, usableAuthor } from './authors'
import { notifyLibrary } from './changes'
import { getBook, saveBook } from './db'
import { yearInTitle } from './shelfQuery'
import { finalizeParagraphs } from './toc'
import type { Book } from './types'

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

/** Returns the id of the (possibly already existing) book for this file. */
export async function importPdf(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<string> {
  if (!isPdfFile(file)) throw new ExtractionError(i18n.t('errors.notPdf'))

  const buffer = await file.arrayBuffer()
  // Hash before parsing: PDF.js transfers the buffer to its worker and detaches it.
  const id = await sha256(buffer)
  const existing = await getBook(id)
  if (existing && !existing.needsFile && existing.paragraphs.length > 0) return id

  const pdf = await extractPdf(new Uint8Array(buffer), onProgress)
  const now = Date.now()
  const title = pdf.title || file.name.replace(/\.pdf$/i, '')
  const year = existing?.year ?? yearInTitle(title)
  let author = usableAuthor(pdf.author)
  if (!author) {
    const firstPage = pdf.paragraphs.filter((paragraph) => paragraph.startPage === 1).map((paragraph) => paragraph.text).join('\n')
    const doi = doiInText(firstPage)
    if (doi) author = usableAuthor(await authorsForDoi(doi))
  }
  if (!author) author = existing?.author ?? ''
  const authorChanged = author !== (existing?.author ?? '')
  await saveBook({
    id,
    fileName: file.name,
    title,
    author,
    description: existing?.description || findDescription(pdf.paragraphs),
    numPages: pdf.numPages,
    paragraphs: pdf.paragraphs,
    toc: pdf.toc,
    pageOffset: pdf.pageOffset,
    addedAt: existing?.addedAt ?? now,
    lastReadAt: existing?.lastReadAt ?? null,
    currentPage: existing && existing.currentPage <= pdf.numPages ? existing.currentPage : 1,
    needsFile: false,
    updatedAt: authorChanged || !existing?.updatedAt ? now : existing.updatedAt,
    folderId: existing?.folderId ?? null,
    tagIds: existing?.tagIds ?? [],
    year,
    classifyUpdatedAt: existing?.classifyUpdatedAt ?? (year ? now : undefined),
  })
  notifyLibrary()
  return id
}

export function progressPercent(book: Book): number {
  if (book.lastReadAt === null) return 0
  return Math.round((book.currentPage / book.numPages) * 100)
}

export function currentChapter(book: Book): string {
  const toc = book.toc ?? []
  if (toc.length > 0) {
    let chapter = ''
    for (const entry of toc) {
      if (entry.pdfPage > book.currentPage) break
      chapter = entry.title
    }
    return chapter
  }
  let chapter = ''
  for (const p of book.paragraphs) {
    if (p.startPage > book.currentPage) break
    if (p.isHeading && !p.isToc) chapter = p.text
  }
  return chapter
}

/** Fills in the contents list for books imported before contents pages were recognised. */
export function prepareBook(book: Book): { book: Book; changed: boolean } {
  const result = finalizeParagraphs(book.paragraphs, book.numPages)
  const changed =
    book.pageOffset !== result.pageOffset ||
    (book.toc?.length ?? -1) !== result.toc.length ||
    book.paragraphs.some(
      (paragraph, index) =>
        !!paragraph.isToc !== !!result.paragraphs[index].isToc ||
        paragraph.isHeading !== result.paragraphs[index].isHeading,
    ) ||
    result.toc.some(
      (entry, index) =>
        entry.title !== book.toc?.[index]?.title ||
        entry.bookPage !== book.toc?.[index]?.bookPage ||
        entry.pdfPage !== book.toc?.[index]?.pdfPage,
    )
  if (!changed) return { book, changed: false }
  return {
    changed: true,
    book: { ...book, paragraphs: result.paragraphs, toc: result.toc, pageOffset: result.pageOffset },
  }
}

function findDescription(paragraphs: Paragraph[]): string {
  const body = paragraphs.filter((p) => !p.isToc)
  const index = body.findIndex((p) => /^abstract$/i.test(p.text))
  let text = index >= 0 ? body[index + 1]?.text : undefined
  text ??= body.map((p) => p.text.match(/^abstract[\s.:—–-]+(.{40,})/i)?.[1]).find(Boolean)
  text ??= body.find((p) => !p.isHeading && p.text.length > 200)?.text
  if (!text) return ''
  return text.length > 300 ? text.slice(0, 300).replace(/\s+\S*$/, '') + '…' : text
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export type ImportState =
  | { kind: 'idle' }
  | { kind: 'loading'; page: number; total: number }
  | { kind: 'error'; message: string }

/** Imports a PDF and leaves the reader closed. */
export function useImportPdf() {
  const [state, setState] = useState<ImportState>({ kind: 'idle' })

  async function importFile(file: File) {
    setState({ kind: 'loading', page: 0, total: 0 })
    try {
      await importPdf(file, (page, total) => setState({ kind: 'loading', page, total }))
      setState({ kind: 'idle' })
    } catch (error) {
      console.error(error)
      const message = error instanceof ExtractionError ? error.message : i18n.t('errors.readFailed')
      setState({ kind: 'error', message })
    }
  }

  return { state, importFile }
}

export function importStatusText(state: ImportState): string | null {
  if (state.kind === 'error') return state.message
  if (state.kind === 'loading') {
    return state.total > 0 ? i18n.t('errors.readingPage', { page: state.page, total: state.total }) : i18n.t('errors.importing')
  }
  return null
}
