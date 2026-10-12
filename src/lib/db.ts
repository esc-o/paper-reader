import { openDB } from 'idb'
import type { DBSchema } from 'idb'
import type { Annotation, AnnotationKind, Book } from './types'
import { dayKey } from './time'

interface PaperReaderDB extends DBSchema {
  books: { key: string; value: Book }
  annotations: { key: string; value: Annotation; indexes: { byBook: string } }
  readingTime: { key: string; value: { date: string; seconds: number } }
}

const dbPromise = openDB<PaperReaderDB>('paper-reader', 1, {
  upgrade(db) {
    db.createObjectStore('books', { keyPath: 'id' })
    db.createObjectStore('annotations', { keyPath: 'id' }).createIndex('byBook', 'bookId')
    db.createObjectStore('readingTime', { keyPath: 'date' })
  },
})

/** Most recently read first. */
export async function listBooks(): Promise<Book[]> {
  const books = await (await dbPromise).getAll('books')
  return books.sort((a, b) => (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt))
}

export async function getBook(id: string): Promise<Book | undefined> {
  return (await dbPromise).get('books', id)
}

export async function saveBook(book: Book): Promise<void> {
  await (await dbPromise).put('books', book)
}

export async function saveProgress(bookId: string, page: number): Promise<void> {
  const tx = (await dbPromise).transaction('books', 'readwrite')
  const book = await tx.store.get(bookId)
  if (book) await tx.store.put({ ...book, currentPage: page, lastReadAt: Date.now() })
  await tx.done
}

export async function deleteBook(bookId: string): Promise<void> {
  const tx = (await dbPromise).transaction(['books', 'annotations'], 'readwrite')
  const annotations = tx.objectStore('annotations')
  const keys = await annotations.index('byBook').getAllKeys(bookId)
  await Promise.all([tx.objectStore('books').delete(bookId), ...keys.map((k) => annotations.delete(k))])
  await tx.done
}

export async function listAnnotations(bookId: string): Promise<Annotation[]> {
  return (await dbPromise).getAllFromIndex('annotations', 'byBook', bookId)
}

export async function saveAnnotation(annotation: Annotation): Promise<void> {
  await (await dbPromise).put('annotations', annotation)
}

export async function deleteAnnotation(id: string): Promise<void> {
  await (await dbPromise).delete('annotations', id)
}

export async function countAnnotationsByKind(): Promise<Record<AnnotationKind, number>> {
  const counts: Record<AnnotationKind, number> = { highlight: 0, underline: 0, comment: 0 }
  for (const a of await (await dbPromise).getAll('annotations')) counts[a.kind]++
  return counts
}

export async function addReadingSeconds(seconds: number): Promise<void> {
  const date = dayKey(new Date())
  const tx = (await dbPromise).transaction('readingTime', 'readwrite')
  const record = await tx.store.get(date)
  await tx.store.put({ date, seconds: (record?.seconds ?? 0) + seconds })
  await tx.done
}

export async function getReadingSeconds(dates: string[]): Promise<number[]> {
  const db = await dbPromise
  const records = await Promise.all(dates.map((d) => db.get('readingTime', d)))
  return records.map((r) => r?.seconds ?? 0)
}
