import { useEffect, useState } from 'react'
import { DropZone } from '../components/DropZone'
import { deleteBook, listBooks } from '../lib/db'
import { importStatusText, progressPercent, useImportPdf } from '../lib/library'
import { routes } from '../lib/router'
import { formatLastRead } from '../lib/time'
import type { Book } from '../lib/types'
import './ShelfPage.css'

export function ShelfPage() {
  const [books, setBooks] = useState<Book[] | null>(null)
  const { state: importState, importAndOpen } = useImportPdf()
  const importStatus = importStatusText(importState)

  useEffect(() => {
    listBooks().then(setBooks)
  }, [])

  async function remove(book: Book) {
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
              <button type="button" className="book-delete" onClick={() => remove(book)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
