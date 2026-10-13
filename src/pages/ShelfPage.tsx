import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnchoredMenu } from '../components/AnchoredMenu'
import { DropZone } from '../components/DropZone'
import { LibraryShell } from '../components/LibraryShell'
import { notifyLibrary } from '../lib/changes'
import { deleteBook, listAnnotations, saveBook } from '../lib/db'
import { importStatusText, progressPercent, useImportPdf } from '../lib/library'
import { routes } from '../lib/router'
import { formatLastRead } from '../lib/time'
import type { Annotation, Book } from '../lib/types'
import { ExportDialog } from '../reader/ExportDialog'
import './ShelfPage.css'

export function ShelfPage() {
  const { t } = useTranslation()
  const [menuId, setMenuId] = useState<string | null>(null)
  const [exporting, setExporting] = useState<{ book: Book; annotations: Annotation[] } | null>(null)
  const { state: importState, importFile } = useImportPdf()
  const importStatus = importStatusText(importState)
  const closeMenu = useCallback(() => setMenuId(null), [])

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
  }

  return (
    <>
      <LibraryShell
        active="shelf"
        kicker={t('shelf.kicker')}
        title={t('shelf.title')}
        beforeFilters={
          <>
            <DropZone onFile={importFile} />
            {importStatus && (
              <p className={`shelf-status${importState.kind === 'error' ? ' error' : ''}`}>{importStatus}</p>
            )}
          </>
        }
      >
        {({ books, folders, tags, visibleBooks }) => (
          <>
            {books && books.length === 0 && <p className="shelf-empty">{t('shelf.empty')}</p>}
            {books && books.length > 0 && visibleBooks.length === 0 && <p className="shelf-empty">{t('shelf.noMatch')}</p>}
            <ul className="book-list">
              {visibleBooks.map((book) => (
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
                  <AnchoredMenu
                    id={`more-${book.id}`}
                    open={menuId === book.id}
                    label={t('shelf.more')}
                    onToggle={() => setMenuId((current) => (current === book.id ? null : book.id))}
                    onClose={closeMenu}
                  >
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
                  </AnchoredMenu>
                </li>
              ))}
            </ul>
          </>
        )}
      </LibraryShell>
      {exporting && (
        <ExportDialog
          book={exporting.book}
          annotations={exporting.annotations}
          onClose={() => setExporting(null)}
        />
      )}
    </>
  )
}
