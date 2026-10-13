import { useHashRoute } from './lib/router'
import { HomePage } from './pages/HomePage'
import { NotesPage } from './pages/NotesPage'
import { ReaderPage } from './pages/ReaderPage'
import { ShelfPage } from './pages/ShelfPage'

function App() {
  const route = useHashRoute()
  if (route.name === 'reader') {
    return <ReaderPage key={`${route.bookId}:${route.noteId ?? ''}`} bookId={route.bookId} noteId={route.noteId} />
  }
  if (route.name === 'shelf') return <ShelfPage />
  if (route.name === 'notes') return <NotesPage />
  return <HomePage />
}

export default App
