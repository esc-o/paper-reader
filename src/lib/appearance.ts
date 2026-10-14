import { useEffect, useState } from 'react'
import { followAppearance } from './settings'

const KEY = 'paper-reader.appearance'
const EVENT = 'paper-reader-appearance'
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

function storeAppearance(mode: Appearance) {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    /* private mode */
  }
  applyAppearance(mode)
  window.dispatchEvent(new Event(EVENT))
}

/** Switches the whole site, including the reading theme, and publishes the change. */
export function setAppearance(next: Appearance) {
  storeAppearance(next)
  followAppearance(next, true)
}

/** Applies a mode that already arrived from this device or the account, without publishing again. */
export function adoptAppearance(next: Appearance) {
  if (readAppearance() === next && document.documentElement.classList.contains('appearance-night') === (next === 'night')) return
  storeAppearance(next)
}

applyAppearance(readAppearance())
followAppearance(readAppearance(), false)

export function useAppearance() {
  const [mode, setMode] = useState<Appearance>(readAppearance)

  useEffect(() => {
    const reload = () => setMode(readAppearance())
    window.addEventListener(EVENT, reload)
    return () => window.removeEventListener(EVENT, reload)
  }, [])

  return { mode, setAppearance }
}
