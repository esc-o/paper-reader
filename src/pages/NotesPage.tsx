import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SiteBar } from '../components/SiteBar'
import { LIBRARY_EVENT } from '../lib/changes'
import { listAllAnnotations, listBooks } from '../lib/db'
import { routes } from '../lib/router'
import type { Annotation, Book } from '../lib/types'
import './ShelfPage.css'
import './NotesPage.css'

type NoteRow = Annotation & { bookTitle: string }

export function NotesPage() {
  const { t } = useTranslation()
  const [notes, setNotes] = useState<NoteRow[] | null>(null)

  useEffect(() => {
    const load = () =>
      Promise.all([listAllAnnotations(), listBooks()]).then(([annotations, books]) => {
        const titles = new Map<string, Book>(books.map((book) => [book.id, book]))
        const rows = annotations
          .map((annotation) => ({
            ...annotation,
            bookTitle: titles.get(annotation.bookId)?.title || annotation.bookId,
          }))
          .sort((a, b) => b.updatedAt - a.updatedAt)
        setNotes(rows)
      })
    load()
    window.addEventListener(LIBRARY_EVENT, load)
    return () => window.removeEventListener(LIBRARY_EVENT, load)
  }, [])

  return (
    <div className="shelf">
      <SiteBar active="notes" />

      <main className="shelf-main">
        <p className="card-label">{t('notesPage.kicker')}</p>
        <h1 className="shelf-title">{t('notesPage.title')}</h1>

        {notes && notes.length === 0 && <p className="shelf-empty">{t('notesPage.empty')}</p>}

        <ul className="note-list">
          {notes?.map((note) => (
            <li key={note.id} className="note-row">
              <a className="note-link" href={routes.reader(note.bookId)}>
                <span className="note-kind">
                  <span className={`stat-dot ${note.kind}`} />
                  {t(`home.${note.kind}`)}
                </span>
                <span className="note-text">{note.comment || note.text}</span>
                {note.comment && note.text && <span className="note-quote">{note.text}</span>}
                <span className="note-book">{t('notesPage.inBook', { title: note.bookTitle })}</span>
              </a>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
