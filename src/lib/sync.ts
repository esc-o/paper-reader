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
  putTombstone,
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
import { consumeFollowUp, runSilently, notifyLibrary } from './changes'
import { adoptAppearance } from './appearance'
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
    if (queued || consumeFollowUp()) {
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
    await pullAccountLibrary(userId)
  } catch (error) {
    console.error(error)
  }
  try {
    await mergeFolders(userId)
  } catch (error) {
    console.error(error)
  }
  try {
    await mergeTags(userId)
  } catch (error) {
    console.error(error)
  }
  try {
    await mergeLabels(userId)
  } catch (error) {
    console.error(error)
  }
  try {
    await pushAccountLibrary(userId)
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
  if (book.updatedAt !== when) await saveBook({ ...book, updatedAt: when }, false)
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
  }, false)
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
  await saveBook(book, false)
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
    else if (!row.deleted_at && ms(row.updated_at) > annotation.updatedAt) await saveAnnotation(normalize(row), false)
  }

  for (const [id, tomb] of tombs) {
    const row = remoteById.get(id)
    if (!row || tomb.updatedAt > ms(row.updated_at)) await pushDeletedAnnotation(userId, tomb)
    else if (!row.deleted_at && ms(row.updated_at) > tomb.updatedAt) {
      await deleteTombstone(tomb.key)
      await saveAnnotation(normalize(row), false)
    }
  }

  for (const row of remote) {
    if (row.deleted_at || localIds.has(row.id) || tombs.has(row.id)) continue
    await saveAnnotation(normalize(row), false)
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
    const payload = remote.payload as Partial<ReaderSettings> & { appearance?: unknown }
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
    const appearance = payload.appearance === 'night' || payload.appearance === 'day'
      ? payload.appearance
      : payload.theme === 'night' || payload.theme === 'day'
        ? payload.theme
        : null
    if (appearance) adoptAppearance(appearance)
  }
}

async function pushSettings(userId: string, settings: ReaderSettings): Promise<void> {
  const client = supabase
  if (!client) return
  const { data, error: readError } = await client.from('reader_settings').select('payload').eq('user_id', userId).maybeSingle()
  if (readError) throw readError
  const previous = data && typeof data.payload === 'object' && data.payload ? data.payload : {}
  const { error } = await client.from('reader_settings').upsert(
    {
      user_id: userId,
      payload: { ...previous, ...syncedSettings(settings) },
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
      if (!record.updatedAt) await saveReadingTime(stamped, false)
      await pushReading(userId, stamped)
    } else if (stamp > ms(row.updated_at)) {
      await pushReading(userId, { ...record, updatedAt: stamp })
    } else if (ms(row.updated_at) > stamp) {
      await saveReadingTime({ date: row.date, seconds: row.seconds, updatedAt: ms(row.updated_at) }, false)
    }
  }

  for (const row of remote) {
    if (localDates.has(row.date)) continue
    await saveReadingTime({ date: row.date, seconds: row.seconds, updatedAt: ms(row.updated_at) }, false)
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
    else if (!row.deleted_at && ms(row.updated_at) > folder.updatedAt) await saveFolder(folderFrom(row), false)
  }

  for (const [id, tomb] of tombs) {
    const row = remoteById.get(id)
    if (!row || tomb.updatedAt > ms(row.updated_at)) await pushDeletedFolder(userId, tomb)
    else if (!row.deleted_at && ms(row.updated_at) > tomb.updatedAt) {
      await deleteTombstone(tomb.key)
      await saveFolder(folderFrom(row), false)
    }
  }

  for (const row of remote) {
    if (row.deleted_at || localIds.has(row.id) || tombs.has(row.id)) continue
    await saveFolder(folderFrom(row), false)
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
    else if (!row.deleted_at && ms(row.updated_at) > tag.updatedAt) await saveTag(tagFrom(row), false)
  }

  for (const [id, tomb] of tombs) {
    const row = remoteById.get(id)
    if (!row || tomb.updatedAt > ms(row.updated_at)) await pushDeletedTag(userId, tomb)
    else if (!row.deleted_at && ms(row.updated_at) > tomb.updatedAt) {
      await deleteTombstone(tomb.key)
      await saveTag(tagFrom(row), false)
    }
  }

  for (const row of remote) {
    if (row.deleted_at || localIds.has(row.id) || tombs.has(row.id)) continue
    await saveTag(tagFrom(row), false)
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
    const tagIds = tagIdList(book.tagIds)
    const hasLabel = stamp > 0 || tagIds.length > 0 || Boolean(book.folderId) || book.year != null
    if (!row) {
      if (!hasLabel) continue
      const when = stamp || Date.now()
      const labeled = { ...book, tagIds, classifyUpdatedAt: when }
      if (when !== stamp) await saveBook(labeled, false)
      await pushLabel(userId, labeled, when)
      continue
    }
    if (stamp > ms(row.updated_at)) await pushLabel(userId, { ...book, tagIds }, stamp)
    else if (ms(row.updated_at) > stamp) {
      await saveBook({
        ...book,
        folderId: row.folder_id,
        tagIds: tagIdList(row.tag_ids),
        year: row.year,
        classifyUpdatedAt: ms(row.updated_at),
      }, false)
    }
  }

  const folderIds = new Set((await listFolders()).map((folder) => folder.id))
  const tagIds = new Set((await listTags()).map((tag) => tag.id))
  for (const book of await listBooks()) {
    const currentTags = tagIdList(book.tagIds)
    const nextTags = currentTags.filter((id) => tagIds.has(id))
    const folderGone = Boolean(book.folderId) && !folderIds.has(book.folderId ?? '')
    if (!folderGone && nextTags.length === currentTags.length) continue
    await saveBook({
      ...book,
      folderId: folderGone ? null : book.folderId,
      tagIds: nextTags,
      classifyUpdatedAt: Date.now(),
    }, false)
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

type CloudFolder = { id: string; name: string; createdAt: number; updatedAt: number; deletedAt: number | null }
type CloudTagRecord = CloudFolder & { color: string }
type CloudLabel = { bookId: string; folderId: string | null; tagIds: string[]; year: number | null; updatedAt: number }

function tagIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string' && id.length > 0)
}

function cloudFolders(value: unknown): CloudFolder[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Partial<CloudFolder>
    if (typeof row.id !== 'string' || !row.id) return []
    return [{
      id: row.id,
      name: typeof row.name === 'string' ? row.name : '',
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
      deletedAt: typeof row.deletedAt === 'number' ? row.deletedAt : null,
    }]
  })
}

function cloudTags(value: unknown): CloudTagRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Partial<CloudTagRecord>
    if (typeof row.id !== 'string' || !row.id) return []
    return [{
      id: row.id,
      name: typeof row.name === 'string' ? row.name : '',
      color: typeof row.color === 'string' ? row.color : 'yellow',
      createdAt: typeof row.createdAt === 'number' ? row.createdAt : 0,
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
      deletedAt: typeof row.deletedAt === 'number' ? row.deletedAt : null,
    }]
  })
}

function cloudLabels(value: unknown): CloudLabel[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Partial<CloudLabel>
    if (typeof row.bookId !== 'string' || !row.bookId) return []
    return [{
      bookId: row.bookId,
      folderId: typeof row.folderId === 'string' ? row.folderId : null,
      tagIds: tagIdList(row.tagIds),
      year: typeof row.year === 'number' ? row.year : null,
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
    }]
  })
}

async function accountRow(userId: string): Promise<{ payload: Record<string, unknown>; updatedAt: string | null }> {
  const client = supabase
  if (!client) return { payload: {}, updatedAt: null }
  const { data, error } = await client.from('reader_settings').select('payload, updated_at').eq('user_id', userId).maybeSingle()
  if (error) throw error
  const payload = data?.payload
  const updatedAt = data && typeof data.updated_at === 'string' ? data.updated_at : null
  return { payload: payload && typeof payload === 'object' ? { ...payload } : {}, updatedAt }
}

/** Copies folders, tags, and book labels out of the account payload when they are newer. */
async function pullAccountLibrary(userId: string): Promise<void> {
  const { payload } = await accountRow(userId)
  const tombs = await listTombstones()
  const folderTombs = new Map(tombs.filter((tomb) => tomb.kind === 'folder').map((tomb) => [tomb.id, tomb]))
  const tagTombs = new Map(tombs.filter((tomb) => tomb.kind === 'tag').map((tomb) => [tomb.id, tomb]))

  for (const folder of cloudFolders(payload.folders)) {
    if (folder.deletedAt) {
      const local = (await listFolders()).find((item) => item.id === folder.id)
      if (!local || folder.deletedAt >= local.updatedAt) {
        if (local) await removeFolderLocal(folder.id)
        await putTombstone({ key: `folder:${folder.id}`, kind: 'folder', id: folder.id, updatedAt: folder.deletedAt })
      }
      continue
    }
    const tomb = folderTombs.get(folder.id)
    if (tomb && tomb.updatedAt >= folder.updatedAt) continue
    const local = (await listFolders()).find((item) => item.id === folder.id)
    if (!local || folder.updatedAt > local.updatedAt) await saveFolder(folderFromCloud(folder), false)
  }

  for (const tag of cloudTags(payload.tags)) {
    if (tag.deletedAt) {
      const local = (await listTags()).find((item) => item.id === tag.id)
      if (!local || tag.deletedAt >= local.updatedAt) {
        if (local) await removeTagLocal(tag.id)
        await putTombstone({ key: `tag:${tag.id}`, kind: 'tag', id: tag.id, updatedAt: tag.deletedAt })
      }
      continue
    }
    const tomb = tagTombs.get(tag.id)
    if (tomb && tomb.updatedAt >= tag.updatedAt) continue
    const local = (await listTags()).find((item) => item.id === tag.id)
    if (!local || tag.updatedAt > local.updatedAt) await saveTag(tagFromCloud(tag), false)
  }

  const books = new Map((await listBooks()).map((book) => [book.id, book]))
  for (const label of cloudLabels(payload.labels)) {
    const book = books.get(label.bookId)
    if (!book || label.updatedAt <= (book.classifyUpdatedAt ?? 0)) continue
    await saveBook({
      ...book,
      folderId: label.folderId,
      tagIds: label.tagIds,
      year: label.year,
      classifyUpdatedAt: label.updatedAt,
    }, false)
  }
}

/** Writes folders, tags, and which books use them back onto the account. */
async function pushAccountLibrary(userId: string): Promise<void> {
  const client = supabase
  if (!client) return
  const { payload, updatedAt: rowUpdatedAt } = await accountRow(userId)
  const tombs = await listTombstones()
  const books = []
  for (const book of await listBooks()) {
    const tagIds = tagIdList(book.tagIds)
    const hasLabel = (book.classifyUpdatedAt ?? 0) > 0 || tagIds.length > 0 || Boolean(book.folderId) || book.year != null
    if (hasLabel && !(book.classifyUpdatedAt ?? 0)) {
      const stamped = { ...book, tagIds, classifyUpdatedAt: Date.now() }
      await saveBook(stamped, false)
      books.push(stamped)
    } else {
      books.push({ ...book, tagIds })
    }
  }
  const settings = loadSettings()
  const updatedAt = settings.updatedAt ? new Date(settings.updatedAt).toISOString() : rowUpdatedAt ?? new Date().toISOString()
  const { error } = await client.from('reader_settings').upsert(
    {
      user_id: userId,
      payload: {
        ...payload,
        ...syncedSettings(settings),
        folders: foldersForAccount(cloudFolders(payload.folders), await listFolders(), tombs),
        tags: tagsForAccount(cloudTags(payload.tags), await listTags(), tombs),
        labels: labelsForAccount(cloudLabels(payload.labels), books, tombs),
      },
      updated_at: new Date(updatedAt).toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) throw error
}

function folderFromCloud(folder: CloudFolder): Folder {
  return { id: folder.id, name: folder.name, createdAt: folder.createdAt || folder.updatedAt, updatedAt: folder.updatedAt }
}

function tagFromCloud(tag: CloudTagRecord): Tag {
  return {
    id: tag.id,
    name: tag.name,
    color: tagColor(tag.color),
    createdAt: tag.createdAt || tag.updatedAt,
    updatedAt: tag.updatedAt,
  }
}

function foldersForAccount(remote: CloudFolder[], local: Folder[], tombs: Tombstone[]): CloudFolder[] {
  const byId = new Map(remote.map((folder) => [folder.id, folder]))
  for (const folder of local) {
    const prev = byId.get(folder.id)
    if (prev?.deletedAt && prev.deletedAt >= folder.updatedAt) continue
    if (!prev || folder.updatedAt >= prev.updatedAt) {
      byId.set(folder.id, {
        id: folder.id,
        name: folder.name,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        deletedAt: null,
      })
    }
  }
  for (const tomb of tombs) {
    if (tomb.kind !== 'folder') continue
    const prev = byId.get(tomb.id)
    if (!prev || tomb.updatedAt >= (prev.deletedAt ?? prev.updatedAt)) {
      byId.set(tomb.id, {
        id: tomb.id,
        name: prev?.name ?? '',
        createdAt: prev?.createdAt ?? tomb.updatedAt,
        updatedAt: tomb.updatedAt,
        deletedAt: tomb.updatedAt,
      })
    }
  }
  return [...byId.values()]
}

function tagsForAccount(remote: CloudTagRecord[], local: Tag[], tombs: Tombstone[]): CloudTagRecord[] {
  const byId = new Map(remote.map((tag) => [tag.id, tag]))
  for (const tag of local) {
    const prev = byId.get(tag.id)
    if (prev?.deletedAt && prev.deletedAt >= tag.updatedAt) continue
    if (!prev || tag.updatedAt >= prev.updatedAt) {
      byId.set(tag.id, {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt,
        deletedAt: null,
      })
    }
  }
  for (const tomb of tombs) {
    if (tomb.kind !== 'tag') continue
    const prev = byId.get(tomb.id)
    if (!prev || tomb.updatedAt >= (prev.deletedAt ?? prev.updatedAt)) {
      byId.set(tomb.id, {
        id: tomb.id,
        name: prev?.name ?? '',
        color: prev?.color ?? 'yellow',
        createdAt: prev?.createdAt ?? tomb.updatedAt,
        updatedAt: tomb.updatedAt,
        deletedAt: tomb.updatedAt,
      })
    }
  }
  return [...byId.values()]
}

function labelsForAccount(remote: CloudLabel[], books: Book[], tombs: Tombstone[]): CloudLabel[] {
  const gone = new Set(tombs.filter((tomb) => tomb.kind === 'book').map((tomb) => tomb.id))
  const byId = new Map(remote.filter((label) => !gone.has(label.bookId)).map((label) => [label.bookId, label]))
  for (const book of books) {
    if (gone.has(book.id)) continue
    const tagIds = tagIdList(book.tagIds)
    const stamp = book.classifyUpdatedAt ?? 0
    const hasLabel = stamp > 0 || tagIds.length > 0 || Boolean(book.folderId) || book.year != null
    if (!hasLabel) continue
    const prev = byId.get(book.id)
    if (prev && prev.updatedAt > stamp) continue
    byId.set(book.id, {
      bookId: book.id,
      folderId: book.folderId ?? null,
      tagIds,
      year: book.year ?? null,
      updatedAt: stamp,
    })
  }
  return [...byId.values()]
}
