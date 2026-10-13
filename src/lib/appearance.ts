import { useEffect, useState } from 'react'
import { followAppearance } from './settings'

const KEY = 'paper-reader.appearance'
export type Appearance = 'day' | 'night'

export function readAppearance(): Appearance {
  try {
    return localStorage.getItem(KEY) === 'night' ? 'night' : 'day'
  } catch {
    return 'day'
  }
}

export function applyAppearance(mode: Appearance) {
  document.documentElement.classList.toggle('appearance-night', mode === 'night')
}

applyAppearance(readAppearance())
followAppearance(readAppearance(), false)

export function useAppearance() {
  const [mode, setMode] = useState<Appearance>(readAppearance)

  useEffect(() => {
    applyAppearance(mode)
  }, [mode])

  function setAppearance(next: Appearance) {
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* private mode */
    }
    setMode(next)
    followAppearance(next, true)
  }

  return { mode, setAppearance }
}
