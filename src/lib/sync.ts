import type { Annotation, Book, Folder, Tag, TagColor } from './types'
import { TAG_COLORS } from './types'
import type { ReadingTimeRecord, Tombstone } from './db'
import {
  deleteTombstone,
  listAllAnnotations,
  listBooks,
  listFolders,
  listReadingTime,
  listTags,
  listTombstones,
  removeAnnotationLocal,
  removeBookLocal,
  removeFolderLocal,
  removeTagLocal,
  saveAnnotation,
  saveBook,
  saveFolder,
  saveReadingTime,
  saveTag,
} from './db'
import { runSilently, notifyLibrary } from './changes'
import { loadSettings, saveSettings, syncedSettings } from './settings'
import type { ReaderSettings } from './settings'
import { supabase } from './supabase'

type RemoteBook = {
  id: string
  file_name: string
  title: string
  author: string
  description: string
  num_pages: number
  current_page: number
  last_read_at: string | null
  page_offset: number
  toc: Book['toc']
  updated_at: string
  deleted_at: string | null
}

type RemoteAnnotation = {
  id: string
  book_id: string
  payload: Annotation
  updated_at: string
  deleted_at: string | null
}

type RemoteReading = {
  date: string
  seconds: number
  updated_at: string
}

type RemoteSettings = {
  payload: Partial<ReaderSettings>
  updated_at: string
}

let running = false
let queued = false

export async function syncNow(): Promise<void> {
  if (!supabase) return
  if (running) {
    queued = true
    return
  }
  running = true
  try {
    const { data } = await supabase.auth.getSession()
    const userId = data.session?.user.id
    if (!userId) return
    await runSilently(() => merge(userId))
    notifyLibrary()
  } catch (error) {
    console.error(error)
  } finally {
    running = false
    if (queued) {
      queued = false
      void syncNow()
    }
  }
}

async function merge(userId: string): Promise<void> {
  await mergeBooks(userId)
  await mergeAnnotations(userId)
  await mergeSettings(userId)
  await mergeReadingTime(userId)
  try {
    await mergeFolders(userId)
    await mergeTags(userId)
    await mergeLabels(userId)
  } catch (error) {
    console.error(error)
  }
}

function ms(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function bookStamp(book: Book): number {
  return book.updatedAt ?? book.lastReadAt ?? book.addedAt ?? 0
}

async function mergeBooks(userId: string): Promise<void> {
  const client = supabase
  if (!client) return
  const { data, error } = await client.from('books').select('*').eq('user_id', userId)
  if (error) throw error
  const remote = (data ?? []) as RemoteBook[]
  const remoteById = new Map(remote.map((row) => [row.id, row]))
  const local = await listBooks()
  const localIds = new Set(local.map((book) => book.id))
  const tombs = new Map(
    (await listTombstones()).filter((tomb) => tomb.kind === 'book').map((tomb) => [tomb.id, tomb]),
  )

  for (const book of local) {
    const row = remoteById.get(book.id)
    const stamp = bookStamp(book)
    if (row?.deleted_at && ms(row.deleted_at) >= stamp) {
      await removeBookLocal(book.id)
      continue
    }
    if (!row || stamp > ms(row.updated_at)) await pushBook(userId, book, stamp)
    else if (ms(row.updated_at) > stamp) await applyBook(book, row)
  }

  for (const [id, tomb] of tombs) {
    const row = remoteById.get(id)
    if (!row || tomb.updatedAt > ms(row.updated_at)) {
      await pushDeletedBook(userId, id, tomb.updatedAt)
    } else if (!row.deleted_at && ms(row.updated_at) > tomb.updatedAt) {
      await deleteTombstone(tomb.key)
      if (!localIds.has(id)) await savePlaceholder(row)
    }
  }

  for (const row of remote) {
    if (row.deleted_at || localIds.has(row.id) || tombs.has(row.id)) continue
    await savePlaceholder(row)
  }
}

function bookRow(userId: string, book: Book, stamp: number, deletedAt: string | null) {
  return {
    user_id: userId,
    id: book.id,
    file_name: book.fileName,
    title: book.title,
    author: book.author,
    description: book.description,
    num_pages: book.numPages,
    current_page: book.currentPage,
    last_read_at: book.lastReadAt ? new Date(book.lastReadAt).toISOString() : null,
    page_offset: book.pageOffset ?? 0,
    toc: book.toc ?? [],
    updated_at: new Date(stamp).toISOString(),
    deleted_at: deletedAt,
  }
}

async function pushBook(userId: string, book: Book, stamp: number): Promise<void> {
  const client = supabase
  if (!client) return
  const when = stamp || Date.now()
  const { error } = await client.from('books').upsert(bookRow(userId, book, when, null), { onConflict: 'user_id,id' })
  if (error) throw error
  if (book.updatedAt !== when) await saveBook({ ...book, updatedAt: when })
}

async function pushDeletedBook(userId: string, id: string, stamp: number): Promise<void> {
  const client = supabase
  if (!client) return
  const when = new Date(stamp).toISOString()
  const { error } = await client.from('books').upsert(
    {
      user_id: userId,
      id,
      file_name: '',
      title: '',
      author: '',
      description: '',
      num_pages: 0,
      current_page: 1,
      last_read_at: null,
      page_offset: 0,
      toc: [],
      updated_at: when,
      deleted_at: when,
    },
    { onConflict: 'user_id,id' },
  )
  if (error) throw error
  await client.from('book_labels').delete().eq('user_id', userId).eq('book_id', id)
}

async function applyBook(local: Book, row: RemoteBook): Promise<void> {
  await saveBook({
    ...local,
    fileName: row.file_name || local.fileName,
    title: row.title || local.title,
    author: row.author,
    description: row.description,
    numPages: row.num_pages || local.numPages,
    currentPage: row.current_page || local.currentPage,
    lastReadAt: row.last_read_at ? ms(row.last_read_at) : local.lastReadAt,
    pageOffset: row.page_offset ?? local.pageOffset,
    toc: local.paragraphs.length > 0 ? local.toc : (row.toc ?? local.toc),
    updatedAt: ms(row.updated_at),
    needsFile: local.needsFile && local.paragraphs.length === 0,
  })
}

async function savePlaceholder(row: RemoteBook): Promise<void> {
  const book: Book = {
    id: row.id,
    fileName: row.file_name,
    title: row.title || row.file_name || row.id,
    author: row.author ?? '',
    description: row.description ?? '',
    numPages: row.num_pages || 1,
    paragraphs: [],
    toc: row.toc ?? [],
    pageOffset: row.page_offset ?? 0,
    addedAt: Date.now(),
    lastReadAt: row.last_read_at ? ms(row.last_read_at) : null,
    currentPage: row.current_page || 1,
    needsFile: true,
    updatedAt: ms(row.updated_at),
  }
  await saveBook(book)
}

async function mergeAnnotations(userId: string): Promise<void> {
  const client = supabase
  if (!client) return
  const { data, error } = await client.from('annotations').select('*').eq('user_id', userId)
  if (error) throw error
  const remote = (data ?? []) as RemoteAnnotation[]
  const remoteById = new Map(remote.map((row) => [row.id, row]))
  const local = await listAllAnnotations()
  const localIds = new Set(local.map((annotation) => annotation.id))
  const tombs = new Map(
    (await listTombstones()).filter((tomb) => tomb.kind === 'annotation').map((tomb) => [tomb.id, tomb]),
  )

  for (const annotation of local) {
    const row = remoteById.get(annotation.id)
    if (row?.deleted_at && ms(row.deleted_at) > annotation.updatedAt) {
      await removeAnnotationLocal(annotation.id)
      continue
    }
    if (!row || annotation.updatedAt > ms(row.updated_at)) await pushAnnotation(userId, annotation)
    else if (!row.deleted_at && ms(row.updated_at) > annotation.updatedAt) await saveAnnotation(normalize(row))
  }

  for (const [id, tomb] of tombs) {
    const row = remoteById.get(id)
    if (!row || tomb.updatedAt > ms(row.updated_at)) await pushDeletedAnnotation(userId, tomb)
    else if (!row.deleted_at && ms(row.updated_at) > tomb.updatedAt) {
      await deleteTombstone(tomb.key)
      await saveAnnotation(normalize(row))
    }
  }

  for (const row of remote) {
    if (row.deleted_at || localIds.has(row.id) || tombs.has(row.id)) continue
    await saveAnnotation(normalize(row))
  }
}

function normalize(row: RemoteAnnotation): Annotation {
  return { ...row.payload, id: row.id, bookId: row.book_id, updatedAt: ms(row.updated_at) }
}

async function pushAnnotation(userId: string, annotation: Annotation): Promise<void> {
  const client = supabase
  if (!client) return
  const { error } = await client.from('annotations').upsert(
    {
      user_id: userId,
      id: annotation.id,
      book_id: annotation.bookId,
      payload: annotation,
      updated_at: new Date(annotation.updatedAt).toISOString(),
      deleted_at: null,
    },
    { onConflict: 'user_id,id' },
  )
  if (error) throw error
}

async function pushDeletedAnnotation(userId: string, tomb: Tombstone): Promise<void> {
  const client = supabase
  if (!client) return
  const when = new Date(tomb.updatedAt).toISOString()
  const { error } = await client.from('annotations').upsert(
    {
      user_id: userId,
      id: tomb.id,
      book_id: tomb.bookId ?? '',
      payload: {},
      updated_at: when,
      deleted_at: when,
    },
    { onConflict: 'user_id,id' },
  )
  if (error) throw error
}

async function mergeSettings(userId: string): Promise<void> {
  const client = supabase
  if (!client) return
  const { data, error } = await client.from('reader_settings').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  const remote = data as RemoteSettings | null
  const local = loadSettings()
  if (!remote) {
    const stamped = { ...local, updatedAt: local.updatedAt || Date.now() }
    if (stamped.updatedAt !== local.updatedAt) saveSettings(stamped)
    await pushSettings(userId, stamped)
    return
  }
  const remoteStamp = ms(remote.updated_at)
  if (local.updatedAt > remoteStamp) {
    await pushSettings(userId, local)
  } else if (remoteStamp > local.updatedAt) {
    const payload = remote.payload
    saveSettings({
      ...local,
      fontSize: payload.fontSize ?? local.fontSize,
      lineHeight: payload.lineHeight ?? local.lineHeight,
      margin: payload.margin ?? local.margin,
      theme: payload.theme === 'sepia' || payload.theme === 'night' || payload.theme === 'day' ? payload.theme : local.theme,
      pageMode: payload.pageMode === 'scroll' || payload.pageMode === 'flip' ? payload.pageMode : local.pageMode,
      fontId: payload.fontId ?? null,
      updatedAt: remoteStamp,
    })
  }
}

async function pushSettings(userId: string, settings: ReaderSettings): Promise<void> {
  const client = supabase
  if (!client) return
  const { error } = await client.from('reader_settings').upsert(
    {
      user_id: userId,
      payload: syncedSettings(settings),
      updated_at: new Date(settings.updatedAt || Date.now()).toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) throw error
}

async function mergeReadingTime(userId: string): Promise<void> {
  const client = supabase
  if (!client) return
  const { data, error } = await client.from('reading_time').select('*').eq('user_id', userId)
  if (error) throw error
  const remote = (data ?? []) as RemoteReading[]
  const remoteByDate = new Map(remote.map((row) => [row.date, row]))
  const local = await listReadingTime()
  const localDates = new Set(local.map((record) => record.date))

  for (const record of local) {
    const row = remoteByDate.get(record.date)
    const stamp = record.updatedAt ?? 0
    if (!row) {
      const stamped = { ...record, updatedAt: stamp || Date.now() }
      if (!record.updatedAt) await saveReadingTime(stamped)
      await pushReading(userId, stamped)
    } else if (stamp > ms(row.updated_at)) {
      await pushReading(userId, { ...record, updatedAt: stamp })
    } else if (ms(row.updated_at) > stamp) {
      await saveReadingTime({ date: row.date, seconds: row.seconds, updatedAt: ms(row.updated_at) })
    }
  }

  for (const row of remote) {
    if (localDates.has(row.date)) continue
    await saveReadingTime({ date: row.date, seconds: row.seconds, updatedAt: ms(row.updated_at) })
  }
}

type RemoteFolder = { id: string; name: string; updated_at: string; deleted_at: string | null; created_at: string | null }
type RemoteTag = RemoteFolder & { color: string }
type RemoteLabel = {
  book_id: string
  folder_id: string | null
  tag_ids: string[] | null
  year: number | null
  updated_at: string
}

function tagColor(value: string): TagColor {
  return TAG_COLORS.includes(value as TagColor) ? (value as TagColor) : 'yellow'
}

async function mergeFolders(userId: string): Promise<void> {
  const client = supabase
  if (!client) return
  const { data, error } = await client.from('folders').select('*').eq('user_id', userId)
  if (error) throw error
  const remote = (data ?? []) as RemoteFolder[]
  const remoteById = new Map(remote.map((row) => [row.id, row]))
  const local = await listFolders()
  const localIds = new Set(local.map((folder) => folder.id))
  const tombs = new Map(
    (await listTombstones()).filter((tomb) => tomb.kind === 'folder').map((tomb) => [tomb.id, tomb]),
  )

  for (const folder of local) {
    const row = remoteById.get(folder.id)
    if (row?.deleted_at && ms(row.deleted_at) >= folder.updatedAt) {
      await removeFolderLocal(folder.id)
      continue
    }
    if (!row || folder.updatedAt > ms(row.updated_at)) await pushFolder(userId, folder)
    else if (!row.deleted_at && ms(row.updated_at) > folder.updatedAt) await saveFolder(folderFrom(row))
  }

  for (const [id, tomb] of tombs) {
    const row = remoteById.get(id)
    if (!row || tomb.updatedAt > ms(row.updated_at)) await pushDeletedFolder(userId, tomb)
    else if (!row.deleted_at && ms(row.updated_at) > tomb.updatedAt) {
      await deleteTombstone(tomb.key)
      await saveFolder(folderFrom(row))
    }
  }

  for (const row of remote) {
    if (row.deleted_at || localIds.has(row.id) || tombs.has(row.id)) continue
    await saveFolder(folderFrom(row))
  }
}

function folderFrom(row: RemoteFolder): Folder {
  return { id: row.id, name: row.name, createdAt: ms(row.created_at) || ms(row.updated_at), updatedAt: ms(row.updated_at) }
}

async function pushFolder(userId: string, folder: Folder): Promise<void> {
  const client = supabase
  if (!client) return
  const when = new Date(folder.updatedAt).toISOString()
  const { error } = await client.from('folders').upsert(
    { user_id: userId, id: folder.id, name: folder.name, created_at: new Date(folder.createdAt).toISOString(), updated_at: when, deleted_at: null },
    { onConflict: 'user_id,id' },
  )
  if (error) throw error
}

async function pushDeletedFolder(userId: string, tomb: Tombstone): Promise<void> {
  const client = supabase
  if (!client) return
  const when = new Date(tomb.updatedAt).toISOString()
  const { error } = await client.from('folders').upsert(
    { user_id: userId, id: tomb.id, name: '', created_at: when, updated_at: when, deleted_at: when },
    { onConflict: 'user_id,id' },
  )
  if (error) throw error
}

async function mergeTags(userId: string): Promise<void> {
  const client = supabase
  if (!client) return
  const { data, error } = await client.from('tags').select('*').eq('user_id', userId)
  if (error) throw error
  const remote = (data ?? []) as RemoteTag[]
  const remoteById = new Map(remote.map((row) => [row.id, row]))
  const local = await listTags()
  const localIds = new Set(local.map((tag) => tag.id))
  const tombs = new Map((await listTombstones()).filter((tomb) => tomb.kind === 'tag').map((tomb) => [tomb.id, tomb]))

  for (const tag of local) {
    const row = remoteById.get(tag.id)
    if (row?.deleted_at && ms(row.deleted_at) >= tag.updatedAt) {
      await removeTagLocal(tag.id)
      continue
    }
    if (!row || tag.updatedAt > ms(row.updated_at)) await pushTag(userId, tag)
    else if (!row.deleted_at && ms(row.updated_at) > tag.updatedAt) await saveTag(tagFrom(row))
  }

  for (const [id, tomb] of tombs) {
    const row = remoteById.get(id)
    if (!row || tomb.updatedAt > ms(row.updated_at)) await pushDeletedTag(userId, tomb)
    else if (!row.deleted_at && ms(row.updated_at) > tomb.updatedAt) {
      await deleteTombstone(tomb.key)
      await saveTag(tagFrom(row))
    }
  }

  for (const row of remote) {
    if (row.deleted_at || localIds.has(row.id) || tombs.has(row.id)) continue
    await saveTag(tagFrom(row))
  }
}

function tagFrom(row: RemoteTag): Tag {
  return {
    id: row.id,
    name: row.name,
    color: tagColor(row.color),
    createdAt: ms(row.created_at) || ms(row.updated_at),
    updatedAt: ms(row.updated_at),
  }
}

async function pushTag(userId: string, tag: Tag): Promise<void> {
  const client = supabase
  if (!client) return
  const when = new Date(tag.updatedAt).toISOString()
  const { error } = await client.from('tags').upsert(
    {
      user_id: userId,
      id: tag.id,
      name: tag.name,
      color: tag.color,
      created_at: new Date(tag.createdAt).toISOString(),
      updated_at: when,
      deleted_at: null,
    },
    { onConflict: 'user_id,id' },
  )
  if (error) throw error
}

async function pushDeletedTag(userId: string, tomb: Tombstone): Promise<void> {
  const client = supabase
  if (!client) return
  const when = new Date(tomb.updatedAt).toISOString()
  const { error } = await client.from('tags').upsert(
    { user_id: userId, id: tomb.id, name: '', color: 'yellow', created_at: when, updated_at: when, deleted_at: when },
    { onConflict: 'user_id,id' },
  )
  if (error) throw error
}

async function mergeLabels(userId: string): Promise<void> {
  const client = supabase
  if (!client) return
  const { data, error } = await client.from('book_labels').select('*').eq('user_id', userId)
  if (error) throw error
  const remote = (data ?? []) as RemoteLabel[]
  const remoteById = new Map(remote.map((row) => [row.book_id, row]))
  const books = await listBooks()

  for (const book of books) {
    const row = remoteById.get(book.id)
    const stamp = book.classifyUpdatedAt ?? 0
    if (!row) {
      if (stamp > 0) await pushLabel(userId, book, stamp)
      continue
    }
    if (stamp > ms(row.updated_at)) await pushLabel(userId, book, stamp)
    else if (ms(row.updated_at) > stamp) {
      await saveBook({
        ...book,
        folderId: row.folder_id,
        tagIds: row.tag_ids ?? [],
        year: row.year,
        classifyUpdatedAt: ms(row.updated_at),
      })
    }
  }

  const folderIds = new Set((await listFolders()).map((folder) => folder.id))
  const tagIds = new Set((await listTags()).map((tag) => tag.id))
  for (const book of await listBooks()) {
    const nextTags = (book.tagIds ?? []).filter((id) => tagIds.has(id))
    const folderGone = Boolean(book.folderId) && !folderIds.has(book.folderId ?? '')
    if (!folderGone && nextTags.length === (book.tagIds ?? []).length) continue
    await saveBook({
      ...book,
      folderId: folderGone ? null : book.folderId,
      tagIds: nextTags,
      classifyUpdatedAt: Date.now(),
    })
  }
}

async function pushLabel(userId: string, book: Book, stamp: number): Promise<void> {
  const client = supabase
  if (!client) return
  const { error } = await client.from('book_labels').upsert(
    {
      user_id: userId,
      book_id: book.id,
      folder_id: book.folderId ?? null,
      tag_ids: book.tagIds ?? [],
      year: book.year ?? null,
      updated_at: new Date(stamp).toISOString(),
    },
    { onConflict: 'user_id,book_id' },
  )
  if (error) throw error
}

async function pushReading(userId: string, record: ReadingTimeRecord): Promise<void> {
  const client = supabase
  if (!client) return
  const { error } = await client.from('reading_time').upsert(
    {
      user_id: userId,
      date: record.date,
      seconds: record.seconds,
      updated_at: new Date(record.updatedAt || Date.now()).toISOString(),
    },
    { onConflict: 'user_id,date' },
  )
  if (error) throw error
}
