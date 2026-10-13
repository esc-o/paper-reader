import { useCallback, useEffect, useState } from 'react'
import { notifyLocalChange } from './changes'

export type ReaderTheme = 'day' | 'sepia' | 'night'
export type PageMode = 'scroll' | 'flip'

export type FabPosition = { x: number; y: number }

export type ReaderSettings = {
  fontSize: number
  lineHeight: number
  margin: number
  theme: ReaderTheme
  pageMode: PageMode
  /** Uploaded font id. Null keeps the interface typeface for the body too. */
  fontId: string | null
  /** When a synced field last changed. 0 means this device has not changed them yet. */
  updatedAt: number
  /** Null until the reader drags the button; then it stays where they left it. */
  fab: FabPosition | null
}

const KEY = 'paper-reader.settings'
const EVENT = 'paper-reader-settings'

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 17,
  lineHeight: 1.75,
  margin: 28,
  theme: 'day',
  pageMode: 'flip',
  fontId: null,
  updatedAt: 0,
  fab: null,
}

const SYNC_KEYS = ['fontSize', 'lineHeight', 'margin', 'theme', 'pageMode', 'fontId'] as const

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
      fontId: typeof parsed.fontId === 'string' && parsed.fontId ? parsed.fontId : null,
      updatedAt: Number.isFinite(parsed.updatedAt) ? (parsed.updatedAt as number) : 0,
      fab,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: ReaderSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings))
  window.dispatchEvent(new Event(EVENT))
}

/** Day and night appearance set the matching reading theme. Sepia stays until the next switch. */
export function followAppearance(mode: 'day' | 'night', publish: boolean): void {
  const prev = loadSettings()
  if (!publish && (prev.theme === 'sepia' || prev.theme === mode)) return
  if (publish && prev.theme === mode) return
  const next = { ...prev, theme: mode, updatedAt: publish ? Date.now() : prev.updatedAt }
  saveSettings(next)
  if (publish) notifyLocalChange()
}

/** Fields that follow the reader from device to device. The button position stays local. */
export function syncedSettings(settings: ReaderSettings) {
  return {
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    margin: settings.margin,
    theme: settings.theme,
    pageMode: settings.pageMode,
    fontId: settings.fontId,
    updatedAt: settings.updatedAt,
  }
}

export function useStoredSettings(): [ReaderSettings, (patch: Partial<ReaderSettings>) => void] {
  const [settings, setSettings] = useState(loadSettings)

  useEffect(() => {
    const reload = () => setSettings(loadSettings())
    window.addEventListener(EVENT, reload)
    return () => window.removeEventListener(EVENT, reload)
  }, [])

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    const prev = loadSettings()
    const next = { ...prev, ...patch }
    const touched = SYNC_KEYS.some((key) => key in patch && patch[key] !== prev[key])
    if (touched) next.updatedAt = Date.now()
    saveSettings(next)
    setSettings(next)
    if (touched) notifyLocalChange()
  }, [])

  return [settings, update]
}
