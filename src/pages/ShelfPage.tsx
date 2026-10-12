import { useEffect, useState } from 'react'
import { DropZone } from '../components/DropZone'
import { deleteBook, listAnnotations, listBooks } from '../lib/db'
import { importStatusText, progressPercent, useImportPdf } from '../lib/library'
import { routes } from '../lib/router'
import { formatLastRead } from '../lib/time'
import type { Annotation, Book } from '../lib/types'
import { ExportDialog } from '../reader/ExportDialog'
import './ShelfPage.css'

export function ShelfPage() {
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
    listBooks().then(setBooks)
  }, [])

  async function openExport(book: Book) {
    setMenuId(null)
    setExporting({ book, annotations: await listAnnotations(book.id) })
  }

  async function remove(book: Book) {
    setMenuId(null)
    if (!window.confirm(`从书架删除《${book.title}》？它的所有标注也会一起删除。`)) return
    await deleteBook(book.id)
    setBooks((list) => list?.filter((b) => b.id !== book.id) ?? null)
  }

  return (
    <div className="shelf">
      <header className="shelf-bar">
        <a href={routes.home}>← 首页</a>
      </header>

      <main className="shelf-main">
        <p className="card-label">Library</p>
        <h1 className="shelf-title">书架</h1>

        <DropZone onFile={importAndOpen} />
        {importStatus && (
          <p className={`shelf-status${importState.kind === 'error' ? ' error' : ''}`}>{importStatus}</p>
        )}

        {books && books.length === 0 && <p className="shelf-empty">书架还是空的，先导入一篇 PDF 吧。</p>}

        <ul className="book-list">
          {books?.map((book) => (
            <li key={book.id} className="book-row">
              <a className="book-link" href={routes.reader(book.id)}>
                <span className="book-title">{book.title}</span>
                <span className="book-meta">
                  {book.author || book.fileName} · {book.numPages} 页
                  {book.lastReadAt ? ` · 最近阅读 ${formatLastRead(book.lastReadAt)}` : ' · 未开始'}
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
                  更多
                </button>
                {menuId === book.id && (
                  <div className="book-menu">
                    <button type="button" onClick={() => openExport(book)}>
                      导出笔记
                    </button>
                    <button type="button" className="danger" onClick={() => remove(book)}>
                      删除
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
