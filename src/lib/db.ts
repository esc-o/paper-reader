import { openDB } from 'idb'
import type { DBSchema } from 'idb'
import { notifyLibrary, notifyLocalChange } from './changes'
import type { Annotation, AnnotationKind, Book, Folder, Tag } from './types'
import { dayKey } from './time'

export type StoredFont = {
  id: string
  name: string
  family: string
  data: ArrayBuffer
  createdAt: number
}

export type Tombstone = {
  key: string
  kind: 'book' | 'annotation' | 'folder' | 'tag'
  id: string
  bookId?: string
  updatedAt: number
}

export type ReadingTimeRecord = {
  date: string
  seconds: number
  updatedAt?: number
}

interface PaperReaderDB extends DBSchema {
  books: { key: string; value: Book }
  annotations: { key: string; value: Annotation; indexes: { byBook: string } }
  readingTime: { key: string; value: ReadingTimeRecord }
  fonts: { key: string; value: StoredFont }
  tombstones: { key: string; value: Tombstone }
  folders: { key: string; value: Folder }
  tags: { key: string; value: Tag }
}

const dbPromise = openDB<PaperReaderDB>('paper-reader', 3, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' })
    if (!db.objectStoreNames.contains('annotations')) {
      db.createObjectStore('annotations', { keyPath: 'id' }).createIndex('byBook', 'bookId')
    }
    if (!db.objectStoreNames.contains('readingTime')) db.createObjectStore('readingTime', { keyPath: 'date' })
    if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts', { keyPath: 'id' })
    if (!db.objectStoreNames.contains('tombstones')) db.createObjectStore('tombstones', { keyPath: 'key' })
    if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' })
    if (!db.objectStoreNames.contains('tags')) db.createObjectStore('tags', { keyPath: 'id' })
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

export async function saveBook(book: Book, notify = true): Promise<void> {
  await (await dbPromise).put('books', book)
  if (notify) notifyLocalChange()
}

export async function saveProgress(bookId: string, page: number): Promise<void> {
  const tx = (await dbPromise).transaction('books', 'readwrite')
  const book = await tx.store.get(bookId)
  if (book) await tx.store.put({ ...book, currentPage: page, lastReadAt: Date.now(), updatedAt: Date.now() })
  await tx.done
  notifyLocalChange()
}

export async function deleteBook(bookId: string): Promise<void> {
  const now = Date.now()
  const annotations = await listAnnotations(bookId)
  for (const annotation of annotations) {
    await putTombstone({
      key: `annotation:${annotation.id}`,
      kind: 'annotation',
      id: annotation.id,
      bookId,
      updatedAt: now,
    })
  }
  await putTombstone({ key: `book:${bookId}`, kind: 'book', id: bookId, updatedAt: now })
  await removeBookLocal(bookId)
  notifyLocalChange()
  notifyLibrary()
}

/** Drops a book without recording a deletion. Used when the cloud says it is gone. */
export async function removeBookLocal(bookId: string): Promise<void> {
  const tx = (await dbPromise).transaction(['books', 'annotations'], 'readwrite')
  const annotations = tx.objectStore('annotations')
  const keys = await annotations.index('byBook').getAllKeys(bookId)
  await Promise.all([tx.objectStore('books').delete(bookId), ...keys.map((key) => annotations.delete(key))])
  await tx.done
}

export async function listAnnotations(bookId: string): Promise<Annotation[]> {
  return (await dbPromise).getAllFromIndex('annotations', 'byBook', bookId)
}

export async function listAllAnnotations(): Promise<Annotation[]> {
  return (await dbPromise).getAll('annotations')
}

export async function saveAnnotation(annotation: Annotation, notify = true): Promise<void> {
  await (await dbPromise).put('annotations', annotation)
  if (notify) notifyLocalChange()
}

/** Stores annotations without treating them as an edit. Local offsets can change while the note stays the same. */
export async function putAnnotations(annotations: Annotation[]): Promise<void> {
  if (annotations.length === 0) return
  const tx = (await dbPromise).transaction('annotations', 'readwrite')
  await Promise.all(annotations.map((annotation) => tx.store.put(annotation)))
  await tx.done
}

export async function deleteAnnotation(id: string): Promise<void> {
  const db = await dbPromise
  const existing = await db.get('annotations', id)
  if (existing) {
    await putTombstone({
      key: `annotation:${id}`,
      kind: 'annotation',
      id,
      bookId: existing.bookId,
      updatedAt: Date.now(),
    })
  }
  await db.delete('annotations', id)
  notifyLocalChange()
}

export async function removeAnnotationLocal(id: string): Promise<void> {
  await (await dbPromise).delete('annotations', id)
}

export async function countAnnotationsByKind(): Promise<Record<AnnotationKind, number>> {
  const counts: Record<AnnotationKind, number> = { highlight: 0, underline: 0, comment: 0 }
  for (const annotation of await (await dbPromise).getAll('annotations')) counts[annotation.kind]++
  return counts
}

export async function addReadingSeconds(seconds: number): Promise<void> {
  const date = dayKey(new Date())
  const tx = (await dbPromise).transaction('readingTime', 'readwrite')
  const record = await tx.store.get(date)
  await tx.store.put({ date, seconds: (record?.seconds ?? 0) + seconds, updatedAt: Date.now() })
  await tx.done
  notifyLocalChange()
}

export async function getReadingSeconds(dates: string[]): Promise<number[]> {
  const db = await dbPromise
  const records = await Promise.all(dates.map((date) => db.get('readingTime', date)))
  return records.map((record) => record?.seconds ?? 0)
}

export async function listReadingTime(): Promise<ReadingTimeRecord[]> {
  return (await dbPromise).getAll('readingTime')
}

export async function saveReadingTime(record: ReadingTimeRecord, notify = true): Promise<void> {
  await (await dbPromise).put('readingTime', record)
  if (notify) notifyLocalChange()
}

export async function listFonts(): Promise<StoredFont[]> {
  const fonts = await (await dbPromise).getAll('fonts')
  return fonts.sort((a, b) => a.createdAt - b.createdAt)
}

export async function saveFont(font: StoredFont): Promise<void> {
  await (await dbPromise).put('fonts', font)
}

export async function deleteFontRecord(id: string): Promise<void> {
  await (await dbPromise).delete('fonts', id)
}

export async function listTombstones(): Promise<Tombstone[]> {
  return (await dbPromise).getAll('tombstones')
}

export async function putTombstone(tombstone: Tombstone): Promise<void> {
  await (await dbPromise).put('tombstones', tombstone)
}

export async function deleteTombstone(key: string): Promise<void> {
  await (await dbPromise).delete('tombstones', key)
}

export async function listFolders(): Promise<Folder[]> {
  const folders = await (await dbPromise).getAll('folders')
  return folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export async function saveFolder(folder: Folder, notify = true): Promise<void> {
  await (await dbPromise).put('folders', folder)
  if (notify) notifyLocalChange()
}

export async function removeFolderLocal(id: string): Promise<void> {
  await (await dbPromise).delete('folders', id)
}

export async function deleteFolder(id: string): Promise<void> {
  const now = Date.now()
  await putTombstone({ key: `folder:${id}`, kind: 'folder', id, updatedAt: now })
  await removeFolderLocal(id)
  const books = await (await dbPromise).getAll('books')
  for (const book of books) {
    if (book.folderId === id) await saveBook({ ...book, folderId: null, classifyUpdatedAt: now })
  }
  notifyLocalChange()
  notifyLibrary()
}

export async function listTags(): Promise<Tag[]> {
  const tags = await (await dbPromise).getAll('tags')
  return tags.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export async function saveTag(tag: Tag, notify = true): Promise<void> {
  await (await dbPromise).put('tags', tag)
  if (notify) notifyLocalChange()
}

export async function removeTagLocal(id: string): Promise<void> {
  await (await dbPromise).delete('tags', id)
}

export async function deleteTag(id: string): Promise<void> {
  const now = Date.now()
  await putTombstone({ key: `tag:${id}`, kind: 'tag', id, updatedAt: now })
  await removeTagLocal(id)
  const books = await (await dbPromise).getAll('books')
  for (const book of books) {
    if (book.tagIds?.includes(id)) {
      await saveBook({ ...book, tagIds: book.tagIds.filter((tagId) => tagId !== id), classifyUpdatedAt: now })
    }
  }
  notifyLocalChange()
  notifyLibrary()
}
