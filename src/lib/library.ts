import { useState } from 'react'
import { extractPdf, ExtractionError } from '../pdf/extractParagraphs'
import type { Paragraph } from '../pdf/extractParagraphs'
import { getBook, saveBook } from './db'
import { routes } from './router'
import type { Book } from './types'

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

/** Returns the id of the (possibly already existing) book for this file. */
export async function importPdf(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<string> {
  if (!isPdfFile(file)) throw new ExtractionError('请选择 PDF 文件。')

  const buffer = await file.arrayBuffer()
  // Hash before parsing: PDF.js transfers the buffer to its worker and detaches it.
  const id = await sha256(buffer)
  if (await getBook(id)) return id

  const pdf = await extractPdf(new Uint8Array(buffer), onProgress)
  await saveBook({
    id,
    fileName: file.name,
    title: pdf.title || file.name.replace(/\.pdf$/i, ''),
    author: pdf.author,
    description: findDescription(pdf.paragraphs),
    numPages: pdf.numPages,
    paragraphs: pdf.paragraphs,
    addedAt: Date.now(),
    lastReadAt: null,
    currentPage: 1,
  })
  return id
}

export function progressPercent(book: Book): number {
  if (book.lastReadAt === null) return 0
  return Math.round((book.currentPage / book.numPages) * 100)
}

export function currentChapter(book: Book): string {
  let chapter = ''
  for (const p of book.paragraphs) {
    if (p.startPage > book.currentPage) break
    if (p.isHeading) chapter = p.text
  }
  return chapter
}

function findDescription(paragraphs: Paragraph[]): string {
  const index = paragraphs.findIndex((p) => /^abstract$/i.test(p.text))
  let text = index >= 0 ? paragraphs[index + 1]?.text : undefined
  text ??= paragraphs.map((p) => p.text.match(/^abstract[\s.:—–-]+(.{40,})/i)?.[1]).find(Boolean)
  text ??= paragraphs.find((p) => p.text.length > 200)?.text
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

/** Imports a PDF and opens it in the reader. */
export function useImportPdf() {
  const [state, setState] = useState<ImportState>({ kind: 'idle' })

  async function importAndOpen(file: File) {
    setState({ kind: 'loading', page: 0, total: 0 })
    try {
      const id = await importPdf(file, (page, total) => setState({ kind: 'loading', page, total }))
      setState({ kind: 'idle' })
      window.location.hash = routes.reader(id)
    } catch (error) {
      console.error(error)
      const message =
        error instanceof ExtractionError ? error.message : '读取 PDF 时出错了，请换一个文件试试。'
      setState({ kind: 'error', message })
    }
  }

  return { state, importAndOpen }
}

export function importStatusText(state: ImportState): string | null {
  if (state.kind === 'error') return state.message
  if (state.kind === 'loading') {
    return state.total > 0 ? `正在读取第 ${state.page} / ${state.total} 页…` : '正在打开 PDF…'
  }
  return null
}
