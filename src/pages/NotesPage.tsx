import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LibraryShell } from '../components/LibraryShell'
import type { LibraryQuery } from '../components/LibraryShell'
import { LIBRARY_EVENT } from '../lib/changes'
import { listAllAnnotations } from '../lib/db'
import { routes } from '../lib/router'
import { bookMatches, compareBooks } from '../lib/shelfQuery'
import type { Annotation, AnnotationKind } from '../lib/types'
import './ShelfPage.css'
import './NotesPage.css'

const KINDS: AnnotationKind[] = ['highlight', 'underline', 'comment']

export function NotesPage() {
  const { t } = useTranslation()
  const [notes, setNotes] = useState<Annotation[] | null>(null)

  useEffect(() => {
    const load = () => listAllAnnotations().then(setNotes)
    load()
    window.addEventListener(LIBRARY_EVENT, load)
    return () => window.removeEventListener(LIBRARY_EVENT, load)
  }, [])

  return (
    <LibraryShell active="notes" kicker={t('notesPage.kicker')} title={t('notesPage.title')}>
      {(query) => <NoteList notes={notes} query={query} />}
    </LibraryShell>
  )
}

function NoteList({ notes, query }: { notes: Annotation[] | null; query: LibraryQuery }) {
  const { t } = useTranslation()
  const [kinds, setKinds] = useState<AnnotationKind[]>([])
  const books = new Map((query.books ?? []).map((book) => [book.id, book]))
  const needle = query.query.trim().toLowerCase()
  const visible = (notes ?? [])
    .filter((note) => {
      if (kinds.length > 0 && !kinds.includes(note.kind)) return false
      const book = books.get(note.bookId)
      if (!book) return query.folderChoice === 'all' && query.activeTags.length === 0 && !needle
      const structural = bookMatches(book, query.tags, {
        folder: query.folderChoice,
        tagIds: query.activeTags,
        query: '',
        sort: query.sort,
      })
      if (!structural) return false
      if (!needle) return true
      const tagText = query.tags.filter((tag) => book.tagIds?.includes(tag.id)).map((tag) => tag.name).join(' ')
      return [note.text, note.comment ?? '', book.title, book.author, tagText].join('\n').toLowerCase().includes(needle)
    })
    .sort((a, b) => {
      const left = books.get(a.bookId)
      const right = books.get(b.bookId)
      if (left && right) {
        const byBook = compareBooks(left, right, query.sort)
        if (byBook !== 0) return byBook
      }
      return b.updatedAt - a.updatedAt
    })

  function toggleKind(kind: AnnotationKind) {
    setKinds((current) => (current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]))
  }

  return (
    <>
      {notes && notes.length > 0 && (
        <div className="note-kinds" role="group" aria-label={t('notesPage.filter')}>
          {KINDS.map((kind) => {
            const on = kinds.includes(kind)
            return (
              <button key={kind} type="button" className={`tag-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggleKind(kind)}>
                <span className={`stat-dot ${kind}`} />
                {t(`toolbar.${kind}`)}
              </button>
            )
          })}
        </div>
      )}
      {notes && notes.length === 0 && <p className="shelf-empty">{t('notesPage.empty')}</p>}
      {notes && notes.length > 0 && visible.length === 0 && <p className="shelf-empty">{t('notesPage.noMatch')}</p>}
      <ul className="note-list">
        {visible.map((note) => (
          <li key={note.id} className="note-row">
            <a className="note-link" href={routes.reader(note.bookId, note.id)}>
              <span className="note-kind">
                <span className={`stat-dot ${note.kind}`} />
                {t(`home.${note.kind}`)}
              </span>
              <span className="note-text">{note.comment || note.text}</span>
              {note.comment && note.text && <span className="note-quote">{note.text}</span>}
              <span className="note-book">{t('notesPage.inBook', { title: books.get(note.bookId)?.title || note.bookId })}</span>
            </a>
          </li>
        ))}
      </ul>
    </>
  )
}
