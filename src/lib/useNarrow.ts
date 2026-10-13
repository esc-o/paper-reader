import { useEffect, useState } from 'react'

export function useNarrow(maxWidth = 767): boolean {
  const query = `(max-width: ${maxWidth}px)`
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])

  return matches
}
