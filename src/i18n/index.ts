import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en'
import es from './es'
import ko from './ko'
import zh from './zh'

const LANG_KEY = 'paper-reader.lang'
const LANGS = ['zh', 'en', 'ko', 'es'] as const
type Lang = (typeof LANGS)[number]

function normalize(lng: string | null | undefined): Lang | null {
  const value = (lng ?? '').toLowerCase()
  if (value.startsWith('zh')) return 'zh'
  if (value.startsWith('ko')) return 'ko'
  if (value.startsWith('es')) return 'es'
  if (value.startsWith('en')) return 'en'
  return null
}

function initialLanguage(): Lang {
  try {
    const saved = normalize(localStorage.getItem(LANG_KEY))
    if (saved) return saved
  } catch {
    // Private mode can block storage; fall through to the browser language.
  }
  return normalize(navigator.language) ?? 'en'
}

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
    ko: { translation: ko },
    es: { translation: es },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

const DOCUMENT_LANG: Record<Lang, string> = { zh: 'zh-CN', en: 'en', ko: 'ko', es: 'es' }

function applyDocumentLanguage(lng: string) {
  const lang = normalize(lng) ?? 'en'
  document.documentElement.lang = DOCUMENT_LANG[lang]
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    // Ignore storage failures.
  }
}

applyDocumentLanguage(i18n.language)
i18n.on('languageChanged', applyDocumentLanguage)

export default i18n
export { LANGS }
export type { Lang }
