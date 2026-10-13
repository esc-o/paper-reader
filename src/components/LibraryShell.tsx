import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LIBRARY_EVENT, notifyLibrary } from '../lib/changes'
import { deleteFolder, deleteTag, listBooks, listFolders, listTags, saveFolder, saveTag } from '../lib/db'
import { filterShelf } from '../lib/shelfQuery'
import type { FolderChoice, ShelfSort } from '../lib/shelfQuery'
import type { Book, Folder, Tag, TagColor } from '../lib/types'
import { TAG_COLORS } from '../lib/types'
import { useNarrow } from '../lib/useNarrow'
import { SiteChrome } from './SiteChrome'

const SORTS: ShelfSort[] = ['recent', 'added', 'year', 'title']

export type LibraryQuery = {
  books: Book[] | null
  folders: Folder[]
  tags: Tag[]
  folderChoice: FolderChoice
  activeTags: string[]
  query: string
  sort: ShelfSort
  visibleBooks: Book[]
}

export function LibraryShell({
  active,
  kicker,
  title,
  beforeFilters,
  children,
}: {
  active: 'shelf' | 'notes'
  kicker: string
  title: string
  beforeFilters?: ReactNode
  children: (query: LibraryQuery) => ReactNode
}) {
  const { t } = useTranslation()
  const narrow = useNarrow(767)
  const [books, setBooks] = useState<Book[] | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [folderChoice, setFolderChoice] = useState<FolderChoice>('all')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ShelfSort>('recent')
  const [addingFolder, setAddingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [addingTag, setAddingTag] = useState(false)
  const [tagName, setTagName] = useState('')
  const [tagColor, setTagColor] = useState<TagColor>('yellow')

  useEffect(() => {
    const load = () => {
      void Promise.all([listBooks(), listFolders(), listTags()]).then(([nextBooks, nextFolders, nextTags]) => {
        setBooks(nextBooks)
        setFolders(nextFolders)
        setTags(nextTags)
        setFolderChoice((current) =>
          current !== 'all' && current !== 'none' && !nextFolders.some((folder) => folder.id === current) ? 'all' : current,
        )
        setActiveTags((current) => current.filter((id) => nextTags.some((tag) => tag.id === id)))
      })
    }
    load()
    window.addEventListener(LIBRARY_EVENT, load)
    return () => window.removeEventListener(LIBRARY_EVENT, load)
  }, [])

  const visibleBooks = books ? filterShelf(books, tags, { folder: folderChoice, tagIds: activeTags, query, sort }) : []
  const currentFolder = folders.find((folder) => folder.id === folderChoice)

  async function createFolder() {
    const name = folderName.trim()
    if (!name) return
    const now = Date.now()
    const folder: Folder = { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now }
    await saveFolder(folder)
    setFolderName('')
    setAddingFolder(false)
    setFolderChoice(folder.id)
    notifyLibrary()
  }

  async function renameFolder() {
    if (!currentFolder) return
    const name = folderName.trim()
    if (!name) return
    await saveFolder({ ...currentFolder, name, updatedAt: Date.now() })
    setRenamingId(null)
    setFolderName('')
    notifyLibrary()
  }

  async function removeFolder(folder: Folder) {
    if (!window.confirm(t('shelf.confirmDeleteFolder', { name: folder.name }))) return
    await deleteFolder(folder.id)
    setFolderChoice('all')
    setRenamingId(null)
  }

  async function createTag() {
    const name = tagName.trim()
    if (!name) return
    const now = Date.now()
    await saveTag({ id: crypto.randomUUID(), name, color: tagColor, createdAt: now, updatedAt: now })
    setTagName('')
    setAddingTag(false)
    notifyLibrary()
  }

  async function removeTag(tag: Tag) {
    if (!window.confirm(t('shelf.confirmDeleteTag', { name: tag.name }))) return
    await deleteTag(tag.id)
  }

  function startRename(folder: Folder) {
    setRenamingId(folder.id)
    setFolderName(folder.name)
    setAddingFolder(false)
  }

  function startAdd() {
    setAddingFolder(true)
    setRenamingId(null)
    setFolderName('')
  }

  const addButton = (
    <button type="button" className="folder-add" aria-label={t('shelf.newFolder')} title={t('shelf.newFolder')} onClick={startAdd}>
      <PlusIcon />
    </button>
  )

  const folderNameForm = (onSubmit: () => void) => (
    <form
      className="folder-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <input
        aria-label={t('shelf.folderName')}
        value={folderName}
        autoFocus
        placeholder={t('shelf.folderName')}
        onChange={(event) => setFolderName(event.target.value)}
      />
    </form>
  )

  const folderControls = (
    <>
      <button type="button" className={folderChoice === 'all' ? 'on' : undefined} onClick={() => setFolderChoice('all')}>
        {t('shelf.folderAll')}
      </button>
      <button type="button" className={folderChoice === 'none' ? 'on' : undefined} onClick={() => setFolderChoice('none')}>
        {t('shelf.folderNone')}
      </button>
      {folders.map((folder) =>
        renamingId === folder.id ? (
          <div key={folder.id}>{folderNameForm(() => void renameFolder())}</div>
        ) : (
          <div className="folder-row" key={folder.id}>
            <button type="button" className={folderChoice === folder.id ? 'on' : undefined} onClick={() => setFolderChoice(folder.id)}>
              {folder.name}
            </button>
            {folderChoice === folder.id && (
              <>
                <button type="button" className="folder-mini" onClick={() => startRename(folder)}>
                  {t('shelf.rename')}
                </button>
                <button type="button" className="folder-mini danger" onClick={() => void removeFolder(folder)}>
                  {t('shelf.delete')}
                </button>
              </>
            )}
          </div>
        ),
      )}
      {addingFolder ? folderNameForm(() => void createFolder()) : addButton}
    </>
  )

  const library: LibraryQuery = {
    books,
    folders,
    tags,
    folderChoice,
    activeTags,
    query,
    sort,
    visibleBooks,
  }

  return (
    <div className="shelf">
      <SiteChrome active={active} />
      <div className="shelf-body">
        {!narrow && (
          <aside className="folder-pane">
            <p className="card-label">{t('shelf.folders')}</p>
            <div className="folder-list">{folderControls}</div>
          </aside>
        )}
        <main className="shelf-main">
          <p className="card-label">{kicker}</p>
          <h1 className="shelf-title">{currentFolder?.name ?? title}</h1>
          {beforeFilters}
          {narrow && (
            <label className="folder-select-label">
              {t('shelf.folders')}
              <select
                value={folderChoice}
                onChange={(event) => {
                  setFolderChoice(event.target.value)
                  setRenamingId(null)
                }}
              >
                <option value="all">{t('shelf.folderAll')}</option>
                <option value="none">{t('shelf.folderNone')}</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
            </label>
          )}
          {narrow && (
            <div className="folder-mobile-actions">
              {currentFolder && renamingId !== currentFolder.id && (
                <>
                  <button type="button" onClick={() => startRename(currentFolder)}>{t('shelf.rename')}</button>
                  <button type="button" onClick={() => void removeFolder(currentFolder)}>{t('shelf.deleteFolder')}</button>
                </>
              )}
              {currentFolder && renamingId === currentFolder.id
                ? folderNameForm(() => void renameFolder())
                : addingFolder
                  ? folderNameForm(() => void createFolder())
                  : addButton}
            </div>
          )}
          <div className="shelf-tools">
            <input
              className="shelf-search"
              type="search"
              value={query}
              placeholder={t('shelf.search')}
              aria-label={t('shelf.search')}
              onChange={(event) => setQuery(event.target.value)}
            />
            <label className="shelf-sort">
              {t('shelf.sort')}
              <select value={sort} onChange={(event) => setSort(event.target.value as ShelfSort)}>
                {SORTS.map((key) => (
                  <option key={key} value={key}>{t(`shelf.sort${key[0].toUpperCase()}${key.slice(1)}`)}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="tag-bar">
            {tags.map((tag) => {
              const on = activeTags.includes(tag.id)
              return (
                <span key={tag.id} className="tag-chip-wrap">
                  <button
                    type="button"
                    className={`tag-chip${on ? ' on' : ''}`}
                    aria-pressed={on}
                    onClick={() => setActiveTags((current) => (on ? current.filter((id) => id !== tag.id) : [...current, tag.id]))}
                  >
                    <span className={`tag-dot ${tag.color}`} />
                    {tag.name}
                  </button>
                  <button type="button" className="tag-x" aria-label={t('shelf.deleteTag')} onClick={() => void removeTag(tag)}>
                    ×
                  </button>
                </span>
              )
            })}
            {addingTag ? (
              <form
                className="tag-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void createTag()
                }}
              >
                <input
                  aria-label={t('shelf.tagName')}
                  value={tagName}
                  autoFocus
                  placeholder={t('shelf.tagName')}
                  onChange={(event) => setTagName(event.target.value)}
                />
                <div className="tag-colors" role="group" aria-label={t('shelf.tags')}>
                  {TAG_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`tag-dot pick ${color}${tagColor === color ? ' on' : ''}`}
                      aria-pressed={tagColor === color}
                      onClick={() => setTagColor(color)}
                    />
                  ))}
                </div>
                <button type="submit">{t('shelf.addTag')}</button>
              </form>
            ) : (
              <button type="button" className="tag-add" onClick={() => setAddingTag(true)}>
                {t('shelf.newTag')}
              </button>
            )}
          </div>
          {children(library)}
        </main>
      </div>
    </div>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5v11M2.5 8h11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
