import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import i18n from '../i18n'
import { deleteFontRecord, listFonts, saveFont } from './db'
import type { StoredFont } from './db'

export type UserFont = {
  id: string
  name: string
  family: string
}

type FontsValue = {
  fonts: UserFont[]
  addFont: (file: File) => Promise<void>
  removeFont: (id: string) => Promise<void>
}

const FontsContext = createContext<FontsValue | null>(null)

function familyName(id: string): string {
  return `PaperFont${id.replace(/-/g, '')}`
}

async function install(font: StoredFont): Promise<void> {
  const face = new FontFace(font.family, font.data.slice(0))
  await face.load()
  document.fonts.add(face)
}

export function FontsProvider({ children }: { children: ReactNode }) {
  const [fonts, setFonts] = useState<UserFont[]>([])

  const refresh = useCallback(async () => {
    const stored = await listFonts()
    const installed: UserFont[] = []
    for (const font of stored) {
      try {
        await install(font)
        installed.push({ id: font.id, name: font.name, family: font.family })
      } catch (error) {
        console.error(error)
      }
    }
    setFonts(installed)
  }, [])

  useEffect(() => {
    let cancelled = false
    listFonts()
      .then(async (stored) => {
        const installed: UserFont[] = []
        for (const font of stored) {
          try {
            await install(font)
            installed.push({ id: font.id, name: font.name, family: font.family })
          } catch (error) {
            console.error(error)
          }
        }
        if (!cancelled) setFonts(installed)
      })
      .catch((error) => console.error(error))
    return () => {
      cancelled = true
    }
  }, [])

  const addFont = useCallback(
    async (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (ext !== 'ttf' && ext !== 'otf') throw new Error(i18n.t('fonts.badType'))
      if (file.size > 15 * 1024 * 1024) throw new Error(i18n.t('fonts.tooBig'))
      const id = crypto.randomUUID()
      const font: StoredFont = {
        id,
        name: file.name.replace(/\.(ttf|otf)$/i, ''),
        family: familyName(id),
        data: await file.arrayBuffer(),
        createdAt: Date.now(),
      }
      try {
        await install(font)
      } catch (error) {
        console.error(error)
        throw new Error(i18n.t('fonts.loadFailed'))
      }
      await saveFont(font)
      await refresh()
    },
    [refresh],
  )

  const removeFont = useCallback(
    async (id: string) => {
      await deleteFontRecord(id)
      setFonts((current) => current.filter((font) => font.id !== id))
    },
    [],
  )

  const value = useMemo(() => ({ fonts, addFont, removeFont }), [fonts, addFont, removeFont])
  return <FontsContext.Provider value={value}>{children}</FontsContext.Provider>
}

export function useFonts(): FontsValue {
  const value = useContext(FontsContext)
  if (!value) throw new Error('FontsProvider is missing')
  return value
}

export function familyFor(fonts: UserFont[], fontId: string | null): string | null {
  if (!fontId) return null
  return fonts.find((font) => font.id === fontId)?.family ?? null
}
