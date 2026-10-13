import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en'
import zh from './zh'

const LANG_KEY = 'paper-reader.lang'

function initialLanguage(): 'zh' | 'en' {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    // Private mode can block storage; fall through to the browser language.
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

function applyDocumentLanguage(lng: string) {
  document.documentElement.lang = lng.startsWith('zh') ? 'zh-CN' : 'en'
  try {
    localStorage.setItem(LANG_KEY, lng.startsWith('zh') ? 'zh' : 'en')
  } catch {
    // Ignore storage failures.
  }
}

applyDocumentLanguage(i18n.language)
i18n.on('languageChanged', applyDocumentLanguage)

export default i18n
