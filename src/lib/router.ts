import { useEffect, useState } from 'react'

export type Route = { name: 'home' } | { name: 'shelf' } | { name: 'reader'; bookId: string }

export const routes = {
  home: '#/',
  shelf: '#/shelf',
  reader: (bookId: string) => `#/read/${encodeURIComponent(bookId)}`,
}

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const reader = path.match(/^\/read\/(.+)$/)
  if (reader) return { name: 'reader', bookId: decodeURIComponent(reader[1]) }
  if (path === '/shelf') return { name: 'shelf' }
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
