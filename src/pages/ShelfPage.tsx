import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TopActions } from '../components/TopActions'
import { DropZone } from '../components/DropZone'
import { LIBRARY_EVENT } from '../lib/changes'
import { deleteBook, listAnnotations, listBooks } from '../lib/db'
import { importStatusText, progressPercent, useImportPdf } from '../lib/library'
import { routes } from '../lib/router'
import { formatLastRead } from '../lib/time'
import type { Annotation, Book } from '../lib/types'
import { ExportDialog } from '../reader/ExportDialog'
import './ShelfPage.css'

export function ShelfPage() {
  const { t } = useTranslation()
  const [books, setBooks] = useState<Book[] | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [exporting, setExporting] = useState<{ book: Book; annotations: Annotation[] } | null>(null)
  const { state: importState, importAndOpen } = useImportPdf()
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
    const load = () => listBooks().then(setBooks)
    load()
    window.addEventListener(LIBRARY_EVENT, load)
    return () => window.removeEventListener(LIBRARY_EVENT, load)
  }, [])

  async function openExport(book: Book) {
    setMenuId(null)
    setExporting({ book, annotations: await listAnnotations(book.id) })
  }

  async function remove(book: Book) {
    setMenuId(null)
    if (!window.confirm(t('shelf.confirmDelete', { title: book.title }))) return
    await deleteBook(book.id)
    setBooks((list) => list?.filter((b) => b.id !== book.id) ?? null)
  }

  return (
    <div className="shelf">
      <header className="shelf-bar">
        <a href={routes.home}>{t('nav.home')}</a>
        <a href={routes.shelf} className="active">{t('nav.shelf')}</a>
        <a href={routes.notes}>{t('nav.notes')}</a>
        <TopActions />
      </header>

      <main className="shelf-main">
        <p className="card-label">{t('shelf.kicker')}</p>
        <h1 className="shelf-title">{t('shelf.title')}</h1>

        <DropZone onFile={importAndOpen} />
        {importStatus && (
          <p className={`shelf-status${importState.kind === 'error' ? ' error' : ''}`}>{importStatus}</p>
        )}

        {books && books.length === 0 && <p className="shelf-empty">{t('shelf.empty')}</p>}

        <ul className="book-list">
          {books?.map((book) => (
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
                    <button type="button" onClick={() => openExport(book)}>
                      {t('shelf.export')}
                    </button>
                    <button type="button" className="danger" onClick={() => remove(book)}>
                      {t('shelf.delete')}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </main>
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
