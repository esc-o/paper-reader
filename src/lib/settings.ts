import { useCallback, useState } from 'react'

export type ReaderTheme = 'day' | 'sepia' | 'night'
export type PageMode = 'scroll' | 'flip'

export type FabPosition = { x: number; y: number }

export type ReaderSettings = {
  fontSize: number
  lineHeight: number
  margin: number
  theme: ReaderTheme
  pageMode: PageMode
  /** Null until the reader drags the button; then it stays where they left it. */
  fab: FabPosition | null
}

const KEY = 'paper-reader.settings'

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 17,
  lineHeight: 1.75,
  margin: 28,
  theme: 'day',
  pageMode: 'flip',
  fab: null,
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback
}

export function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>
    const theme = parsed.theme === 'sepia' || parsed.theme === 'night' ? parsed.theme : 'day'
    const pageMode = parsed.pageMode === 'scroll' ? 'scroll' : 'flip'
    const fab =
      parsed.fab && Number.isFinite(parsed.fab.x) && Number.isFinite(parsed.fab.y) ? parsed.fab : null
    return {
      fontSize: clamp(parsed.fontSize ?? DEFAULT_SETTINGS.fontSize, 15, 24, DEFAULT_SETTINGS.fontSize),
      lineHeight: clamp(parsed.lineHeight ?? DEFAULT_SETTINGS.lineHeight, 1.4, 2.2, DEFAULT_SETTINGS.lineHeight),
      margin: clamp(parsed.margin ?? DEFAULT_SETTINGS.margin, 12, 80, DEFAULT_SETTINGS.margin),
      theme,
      pageMode,
      fab,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: ReaderSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings))
}

export function useStoredSettings(): [ReaderSettings, (patch: Partial<ReaderSettings>) => void] {
  const [settings, setSettings] = useState(loadSettings)
  const update = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])
  return [settings, update]
}
