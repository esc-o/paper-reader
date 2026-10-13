import { useEffect, useState } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'shelf' }
  | { name: 'notes' }
  | { name: 'reader'; bookId: string; noteId?: string }

export const routes = {
  home: '#/',
  shelf: '#/shelf',
  notes: '#/notes',
  reader: (bookId: string, noteId?: string) => {
    const path = `#/read/${encodeURIComponent(bookId)}`
    return noteId ? `${path}?note=${encodeURIComponent(noteId)}` : path
  },
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  const queryAt = raw.indexOf('?')
  const path = queryAt >= 0 ? raw.slice(0, queryAt) : raw
  const params = new URLSearchParams(queryAt >= 0 ? raw.slice(queryAt + 1) : '')
  const reader = path.match(/^\/read\/(.+)$/)
  if (reader) {
    const noteId = params.get('note') || undefined
    return { name: 'reader', bookId: decodeURIComponent(reader[1]), noteId }
  }
  if (path === '/shelf') return { name: 'shelf' }
  if (path === '/notes') return { name: 'notes' }
  return { name: 'home' }
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
