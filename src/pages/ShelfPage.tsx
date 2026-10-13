import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TopActions } from '../components/TopActions'
import { DropZone } from '../components/DropZone'
import { LIBRARY_EVENT, notifyLibrary } from '../lib/changes'
import { deleteBook, deleteFolder, deleteTag, listAnnotations, listBooks, listFolders, listTags, saveBook, saveFolder, saveTag } from '../lib/db'
import { importStatusText, progressPercent, useImportPdf } from '../lib/library'
import { routes } from '../lib/router'
import { filterShelf } from '../lib/shelfQuery'
import type { FolderChoice, ShelfSort } from '../lib/shelfQuery'
import { formatLastRead } from '../lib/time'
import type { Annotation, Book, Folder, Tag, TagColor } from '../lib/types'
import { TAG_COLORS } from '../lib/types'
import { useNarrow } from '../lib/useNarrow'
import { ExportDialog } from '../reader/ExportDialog'
import './ShelfPage.css'

const SORTS: ShelfSort[] = ['recent', 'added', 'year', 'title']

export function ShelfPage() {
  const { t } = useTranslation()
  const narrow = useNarrow(860)
  const [books, setBooks] = useState<Book[] | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [folderChoice, setFolderChoice] = useState<FolderChoice>('all')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ShelfSort>('recent')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [exporting, setExporting] = useState<{ book: Book; annotations: Annotation[] } | null>(null)
  const [addingFolder, setAddingFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [addingTag, setAddingTag] = useState(false)
  const [tagName, setTagName] = useState('')
  const [tagColor, setTagColor] = useState<TagColor>('yellow')
  const { state: importState, importFile } = useImportPdf()
  const importStatus = importStatusText(importState)

  useEffect(() => {
    if (!menuId) return
    const close = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof Node && document.getElementById(`more-${menuId}`)?.contains(target)) return
      setMenuId(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuId])

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

  const visible = books ? filterShelf(books, tags, { folder: folderChoice, tagIds: activeTags, query, sort }) : []
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

  async function moveBook(book: Book, folderId: string) {
    await saveBook({ ...book, folderId: folderId || null, classifyUpdatedAt: Date.now() })
    notifyLibrary()
  }

  async function toggleBookTag(book: Book, tagId: string) {
    const ids = new Set(book.tagIds ?? [])
    if (ids.has(tagId)) ids.delete(tagId)
    else ids.add(tagId)
    await saveBook({ ...book, tagIds: [...ids], classifyUpdatedAt: Date.now() })
    notifyLibrary()
  }

  async function setYear(book: Book, raw: string) {
    const year = raw.trim() === '' ? null : Number(raw)
    if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 2100)) return
    await saveBook({ ...book, year, classifyUpdatedAt: Date.now() })
    notifyLibrary()
  }

  async function openExport(book: Book) {
    setMenuId(null)
    setExporting({ book, annotations: await listAnnotations(book.id) })
  }

  async function remove(book: Book) {
    setMenuId(null)
    if (!window.confirm(t('shelf.confirmDelete', { title: book.title }))) return
    await deleteBook(book.id)
    setBooks((list) => list?.filter((item) => item.id !== book.id) ?? null)
  }

  function startRename(folder: Folder) {
    setRenamingId(folder.id)
    setFolderName(folder.name)
    setAddingFolder(false)
  }

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
          <form
            key={folder.id}
            className="folder-form"
            onSubmit={(event) => {
              event.preventDefault()
              void renameFolder()
            }}
          >
            <input
              aria-label={t('shelf.folderName')}
              value={folderName}
              autoFocus
              onChange={(event) => setFolderName(event.target.value)}
            />
          </form>
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
      {addingFolder ? (
        <form
          className="folder-form"
          onSubmit={(event) => {
            event.preventDefault()
            void createFolder()
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
      ) : (
        <button
          type="button"
          className="folder-add"
          onClick={() => {
            setAddingFolder(true)
            setRenamingId(null)
            setFolderName('')
          }}
        >
          {t('shelf.newFolder')}
        </button>
      )}
    </>
  )

  return (
    <div className="shelf">
      <header className="shelf-bar">
        <a href={routes.home}>{t('nav.home')}</a>
        <a href={routes.shelf} className="active">{t('nav.shelf')}</a>
        <a href={routes.notes}>{t('nav.notes')}</a>
        <TopActions />
      </header>

      <div className="shelf-body">
        {!narrow && (
          <aside className="folder-pane">
            <p className="card-label">{t('shelf.folders')}</p>
            <div className="folder-list">{folderControls}</div>
          </aside>
        )}

        <main className="shelf-main">
          <p className="card-label">{t('shelf.kicker')}</p>
          <h1 className="shelf-title">{currentFolder?.name ?? t('shelf.title')}</h1>

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
              {currentFolder && renamingId === currentFolder.id ? (
                <form
                  className="folder-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void renameFolder()
                  }}
                >
                  <input aria-label={t('shelf.folderName')} value={folderName} autoFocus onChange={(event) => setFolderName(event.target.value)} />
                </form>
              ) : addingFolder ? (
                <form
                  className="folder-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void createFolder()
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
              ) : (
                <button type="button" onClick={() => { setAddingFolder(true); setFolderName('') }}>{t('shelf.newFolder')}</button>
              )}
            </div>
          )}

          <DropZone onFile={importFile} />
          {importStatus && (
            <p className={`shelf-status${importState.kind === 'error' ? ' error' : ''}`}>{importStatus}</p>
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

          {books && books.length === 0 && <p className="shelf-empty">{t('shelf.empty')}</p>}
          {books && books.length > 0 && visible.length === 0 && <p className="shelf-empty">{t('shelf.noMatch')}</p>}

          <ul className="book-list">
            {visible.map((book) => (
              <li key={book.id} className="book-row">
                <a className="book-link" href={routes.reader(book.id)}>
                  <span className="book-title">{book.title}</span>
                  <span className="book-meta">
                    {book.author || book.fileName} · {t('shelf.pages', { count: book.numPages })}
                    {book.needsFile
                      ? ` · ${t('shelf.reimport')}`
                      : book.lastReadAt
                        ? ` · ${t('shelf.lastRead', { time: formatLastRead(book.lastReadAt) })}`
                        : ` · ${t('shelf.notStarted')}`}
                  </span>
                  {(book.tagIds?.length ?? 0) > 0 && (
                    <span className="book-tags">
                      {tags.filter((tag) => book.tagIds?.includes(tag.id)).map((tag) => (
                        <span key={tag.id} className="tag-chip tiny">
                          <span className={`tag-dot ${tag.color}`} />
                          {tag.name}
                        </span>
                      ))}
                    </span>
                  )}
                </a>
                <span className="book-progress">{progressPercent(book)}%</span>
                <div className="book-more" id={`more-${book.id}`}>
                  <button
                    type="button"
                    className="book-delete"
                    aria-expanded={menuId === book.id}
                    onClick={() => setMenuId((current) => (current === book.id ? null : book.id))}
                  >
                    {t('shelf.more')}
                  </button>
                  {menuId === book.id && (
                    <div className="book-menu">
                      <label className="menu-field">
                        {t('shelf.folders')}
                        <select value={book.folderId ?? ''} onChange={(event) => void moveBook(book, event.target.value)}>
                          <option value="">{t('shelf.folderNone')}</option>
                          {folders.map((folder) => (
                            <option key={folder.id} value={folder.id}>{folder.name}</option>
                          ))}
                        </select>
                      </label>
                      <div className="menu-field">
                        <span>{t('shelf.tags')}</span>
                        {tags.length === 0 && <span className="menu-hint">{t('shelf.noTags')}</span>}
                        <div className="menu-tags">
                          {tags.map((tag) => {
                            const on = book.tagIds?.includes(tag.id) ?? false
                            return (
                              <button key={tag.id} type="button" className={on ? 'on' : undefined} aria-pressed={on} onClick={() => void toggleBookTag(book, tag.id)}>
                                <span className={`tag-dot ${tag.color}`} />
                                {tag.name}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                      <label className="menu-field">
                        {t('shelf.year')}
                        <input
                          type="number"
                          inputMode="numeric"
                          defaultValue={book.year ?? ''}
                          placeholder="2019"
                          onBlur={(event) => void setYear(book, event.target.value)}
                        />
                      </label>
                      <button type="button" onClick={() => void openExport(book)}>{t('shelf.export')}</button>
                      <button type="button" className="danger" onClick={() => void remove(book)}>{t('shelf.delete')}</button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </main>
      </div>
      {exporting && (
        <ExportDialog
          book={exporting.book}
          annotations={exporting.annotations}
          onClose={() => setExporting(null)}
        />
      )}
    </div>
  )
}
