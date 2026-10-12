import { useHashRoute } from './lib/router'
import { HomePage } from './pages/HomePage'
import { ReaderPage } from './pages/ReaderPage'
import { ShelfPage } from './pages/ShelfPage'

function App() {
  const route = useHashRoute()
  if (route.name === 'reader') return <ReaderPage key={route.bookId} bookId={route.bookId} />
  if (route.name === 'shelf') return <ShelfPage />
  return <HomePage />
}

export default App
