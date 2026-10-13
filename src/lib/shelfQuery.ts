import type { Book, Tag } from './types'

export type FolderChoice = 'all' | 'none' | string
export type ShelfSort = 'recent' | 'added' | 'year' | 'title'

export function yearInTitle(title: string): number | null {
  const match = title.match(/\b(1[5-9]\d{2}|20\d{2})\b/)
  return match ? Number(match[1]) : null
}

/** A year the reader set, otherwise a year written in the title. */
export function bookYear(book: Book): number | null {
  return typeof book.year === 'number' ? book.year : yearInTitle(book.title)
}

export function filterShelf(
  books: Book[],
  tags: Tag[],
  options: { folder: FolderChoice; tagIds: string[]; query: string; sort: ShelfSort },
): Book[] {
  const needle = options.query.trim().toLowerCase()
  const selected = new Set(options.tagIds)
  const names = new Map(tags.map((tag) => [tag.id, tag.name.toLowerCase()]))
  const matched = books.filter((book) => {
    if (options.folder === 'none' && book.folderId) return false
    if (options.folder !== 'all' && options.folder !== 'none' && book.folderId !== options.folder) return false
    if (selected.size > 0 && !(book.tagIds ?? []).some((id) => selected.has(id))) return false
    if (!needle) return true
    const tagText = (book.tagIds ?? []).map((id) => names.get(id) ?? '').join(' ')
    return [book.title, book.author, tagText].join('\n').toLowerCase().includes(needle)
  })
  return matched.sort((a, b) => compareBooks(a, b, options.sort))
}

function compareBooks(a: Book, b: Book, sort: ShelfSort): number {
  if (sort === 'title') return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  if (sort === 'added') return b.addedAt - a.addedAt
  if (sort === 'year') {
    const ay = bookYear(a)
    const by = bookYear(b)
    if (ay === null && by === null) return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    if (ay === null) return 1
    if (by === null) return -1
    return by - ay
  }
  return (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || b.addedAt - a.addedAt
}
