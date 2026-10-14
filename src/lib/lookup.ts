import { useEffect, useState } from 'react'
import i18n from '../i18n'

export type DictionaryEntry = {
  word: string
  source: string
  phonetics: { text: string; audio?: string }[]
  meanings: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[]
}

export type LookupResult =
  | { kind: 'dictionary'; entry: DictionaryEntry }
  | { kind: 'translation'; source: string; translated: string; truncated: boolean; notice?: string; local?: boolean }

export class LookupError extends Error {}

type RawEntry = {
  word: string
  phonetic?: string
  phonetics?: { text?: string; audio?: string }[]
  meanings?: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[]
}

type WikiResponse = Record<
  string,
  {
    partOfSpeech?: string
    definitions?: { definition?: string; parsedExamples?: { example?: string }[] }[]
  }[]
>

type DictOutcome =
  | { kind: 'found'; entry: DictionaryEntry }
  | { kind: 'missing' }
  | { kind: 'failed' }

const CACHE_KEY = 'paper-reader.dictionary'
const CACHE_LIMIT = 400
const FREE_DICTIONARY_TIMEOUT_MS = 3000
const FALLBACK_TIMEOUT_MS = 8000

function stripPunctuation(text: string): string {
  return text.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

/** Lower case, with punctuation taken off both ends. */
export function normalizeWord(text: string): string {
  return stripPunctuation(text).toLowerCase()
}

export function isSingleEnglishWord(text: string): boolean {
  return /^[a-z]+(?:['’-][a-z]+)*$/i.test(stripPunctuation(text))
}

function stripHtml(html: string): string {
  const text =
    typeof DOMParser === 'undefined'
      ? html.replace(/<[^>]+>/g, ' ')
      : (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '')
  return text.replace(/\s+/g, ' ').trim()
}

function readCache(word: string): { hit: boolean; entry: DictionaryEntry | null } {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Record<string, DictionaryEntry | null>
    if (Object.prototype.hasOwnProperty.call(all, word)) return { hit: true, entry: all[word] }
  } catch {
    // Ignore a broken cache and look the word up again.
  }
  return { hit: false, entry: null }
}

function writeCache(word: string, entry: DictionaryEntry | null): void {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Record<string, DictionaryEntry | null>
    if (!Object.prototype.hasOwnProperty.call(all, word) && Object.keys(all).length >= CACHE_LIMIT) {
      const oldest = Object.keys(all)[0]
      if (oldest) delete all[oldest]
    }
    all[word] = entry
    localStorage.setItem(CACHE_KEY, JSON.stringify(all))
  } catch {
    // A full localStorage should not block showing the result.
  }
}

/**
 * Single English words go to the dictionary; anything else gets translated.
 * A word is requested from Free Dictionary first, then Wiktionary. Only when both
 * fail do we show a translation. Results are cached, including words neither dictionary has.
 */
export async function lookup(text: string, signal: AbortSignal): Promise<LookupResult> {
  if (!isSingleEnglishWord(text)) return translate(text, signal)

  const word = normalizeWord(text)
  try {
    const entry = await lookupDictionary(word, signal)
    if (entry) return { kind: 'dictionary', entry }
    return { ...(await translate(word, signal)), notice: i18n.t('lookup.missingDict') }
  } catch (error) {
    if (signal.aborted || !(error instanceof LookupError)) throw error
    return { ...(await translate(word, signal)), notice: i18n.t('lookup.bothDown') }
  }
}

async function lookupDictionary(word: string, signal: AbortSignal): Promise<DictionaryEntry | null> {
  const cached = readCache(word)
  if (cached.hit) return cached.entry

  const free = await fromFreeDictionary(word, signal)
  if (free.kind === 'found') {
    writeCache(word, free.entry)
    return free.entry
  }

  const wiki = await fromWiktionary(word, signal)
  if (wiki.kind === 'found') {
    writeCache(word, wiki.entry)
    return wiki.entry
  }

  if (free.kind === 'missing' && wiki.kind === 'missing') {
    writeCache(word, null)
    return null
  }
  throw new LookupError(i18n.t('lookup.dictDown'))
}

async function request(url: string, signal: AbortSignal, timeoutMs: number): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) })
  } catch (error) {
    if (signal.aborted) throw error
    return null
  }
}

async function fromFreeDictionary(word: string, signal: AbortSignal): Promise<DictOutcome> {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
  const res = await request(url, signal, FREE_DICTIONARY_TIMEOUT_MS)
  if (!res) return { kind: 'failed' }
  if (res.status === 404) return { kind: 'missing' }
  if (!res.ok) return { kind: 'failed' }

  let entries: RawEntry[]
  try {
    entries = (await res.json()) as RawEntry[]
  } catch {
    return { kind: 'failed' }
  }
  const entry = parseFreeDictionary(word, entries)
  return entry ? { kind: 'found', entry } : { kind: 'missing' }
}

function parseFreeDictionary(word: string, entries: RawEntry[]): DictionaryEntry | null {
  const phonetics = new Map<string, string | undefined>()
  const meanings = new Map<string, DictionaryEntry['meanings'][number]['definitions']>()
  for (const entry of entries) {
    if (entry.phonetic && !phonetics.has(entry.phonetic)) phonetics.set(entry.phonetic, undefined)
    for (const phonetic of entry.phonetics ?? []) {
      if (phonetic.text && !phonetics.get(phonetic.text)) phonetics.set(phonetic.text, phonetic.audio || undefined)
    }
    for (const meaning of entry.meanings ?? []) {
      meanings.set(meaning.partOfSpeech, [...(meanings.get(meaning.partOfSpeech) ?? []), ...meaning.definitions])
    }
  }
  if (meanings.size === 0) return null
  return {
    word: entries[0]?.word ?? word,
    source: 'Free Dictionary API',
    phonetics: [...phonetics].map(([text, audio]) => ({ text, audio })),
    meanings: [...meanings].map(([partOfSpeech, definitions]) => ({ partOfSpeech, definitions })),
  }
}

async function fromWiktionary(word: string, signal: AbortSignal): Promise<DictOutcome> {
  const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`
  const res = await request(url, signal, FALLBACK_TIMEOUT_MS)
  if (!res) return { kind: 'failed' }
  if (res.status === 404) return { kind: 'missing' }
  if (!res.ok) return { kind: 'failed' }

  let data: WikiResponse
  try {
    data = (await res.json()) as WikiResponse
  } catch {
    return { kind: 'failed' }
  }
  const entry = parseWiktionary(word, data)
  return entry ? { kind: 'found', entry } : { kind: 'missing' }
}

function parseWiktionary(word: string, data: WikiResponse): DictionaryEntry | null {
  const meanings = (data.en ?? []).flatMap((group) => {
    const definitions = (group.definitions ?? []).flatMap((item) => {
      const definition = item.definition ? stripHtml(item.definition) : ''
      if (!definition) return []
      const example = item.parsedExamples?.map((ex) => (ex.example ? stripHtml(ex.example) : '')).find(Boolean)
      return [{ definition, example }]
    })
    if (definitions.length === 0) return []
    return [{ partOfSpeech: group.partOfSpeech || 'definition', definitions }]
  })
  if (meanings.length === 0) return null
  return { word, source: 'Wiktionary', phonetics: [], meanings }
}

const MAX_QUERY_BYTES = 480

async function translate(
  text: string,
  signal: AbortSignal,
): Promise<Extract<LookupResult, { kind: 'translation' }>> {
  const source = text.replace(/\s+/g, ' ').trim()
  const encoder = new TextEncoder()
  let query = source
  while (encoder.encode(query).length > MAX_QUERY_BYTES) {
    query = query.slice(0, Math.floor(query.length * 0.9))
  }
  const truncated = query.length < source.length
  if (truncated) query = query.replace(/\s+\S*$/, '')

  const pair = targetLangpair()
  if (!pair) return { kind: 'translation', source: query, translated: query, truncated, local: true }

  const params = new URLSearchParams({ q: query, langpair: pair })
  const res = await request(`https://api.mymemory.translated.net/get?${params}`, signal, FALLBACK_TIMEOUT_MS)
  if (!res) throw new LookupError(i18n.t('lookup.offline'))
  if (!res.ok) throw new LookupError(i18n.t('lookup.translateStatus', { status: res.status }))

  const data = (await res.json()) as {
    responseStatus: number | string
    responseDetails?: string
    responseData?: { translatedText?: string }
  }
  const status = Number(data.responseStatus)
  if (status === 429) throw new LookupError(i18n.t('lookup.quota'))
  const translated = data.responseData?.translatedText
  if (status !== 200 || !translated) {
    throw new LookupError(data.responseDetails || i18n.t('lookup.translateFailed'))
  }

  const decoded = new DOMParser().parseFromString(translated, 'text/html').documentElement.textContent
  return { kind: 'translation', source: query, translated: decoded ?? translated, truncated }
}

const GLOSS_KEY = 'paper-reader.gloss'

export type UiLanguage = 'zh' | 'en' | 'ko' | 'es'

export function glossLanguage(): UiLanguage {
  const lng = i18n.language.toLowerCase()
  if (lng.startsWith('zh')) return 'zh'
  if (lng.startsWith('ko')) return 'ko'
  if (lng.startsWith('es')) return 'es'
  return 'en'
}

function targetLangpair(): string | null {
  const lang = glossLanguage()
  if (lang === 'zh') return 'en|zh-CN'
  if (lang === 'ko') return 'en|ko'
  if (lang === 'es') return 'en|es'
  return null
}

function glossCacheKey(text: string): string {
  return `${glossLanguage()}\u0000${text}`
}

function readGloss(text: string): string | null {
  try {
    const all = JSON.parse(localStorage.getItem(GLOSS_KEY) || '{}') as Record<string, string>
    return all[glossCacheKey(text)] ?? null
  } catch {
    return null
  }
}

function writeGloss(text: string, gloss: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(GLOSS_KEY) || '{}') as Record<string, string>
    const key = glossCacheKey(text)
    if (!Object.prototype.hasOwnProperty.call(all, key) && Object.keys(all).length >= CACHE_LIMIT) {
      const oldest = Object.keys(all)[0]
      if (oldest) delete all[oldest]
    }
    all[key] = gloss
    localStorage.setItem(GLOSS_KEY, JSON.stringify(all))
  } catch {
    // A full localStorage should not hide the English definition.
  }
}

const LOOKED_KEY = 'paper-reader.looked-up'
const LOOKED_EVENT = 'paper-reader-lookups'

type SavedLookup = { gloss: string; zh?: string; native?: string; lang?: UiLanguage }

export type LookedUpWord = { word: string; gloss: string }

function readSavedLookups(): Record<string, SavedLookup> {
  try {
    const all = JSON.parse(localStorage.getItem(LOOKED_KEY) || '{}') as Record<string, SavedLookup>
    return all && typeof all === 'object' ? all : {}
  } catch {
    return {}
  }
}

function nativeOf(saved: SavedLookup): { text: string; lang: UiLanguage } | null {
  const text = (saved.native ?? saved.zh)?.trim()
  if (!text) return null
  const lang = saved.lang ?? (saved.zh ? 'zh' : glossLanguage())
  return { text, lang }
}

function displayGloss(saved: SavedLookup): string {
  const gloss = saved.gloss.trim()
  const native = nativeOf(saved)
  if (glossLanguage() !== 'en' && native && native.lang === glossLanguage()) {
    if (gloss && native.text !== gloss) return `${native.text}\n${gloss}`
    return native.text || gloss
  }
  return gloss || ''
}

function glossFromEntry(entry: DictionaryEntry): SavedLookup | null {
  const meaning = entry.meanings[0]
  const definition = meaning?.definitions[0]?.definition?.trim()
  if (!definition) return null
  const gloss = meaning.partOfSpeech ? `${meaning.partOfSpeech} · ${definition}` : definition
  const native = readGloss(definition)?.trim()
  const lang = glossLanguage()
  return { gloss, native: native && native !== definition && lang !== 'en' ? native : undefined, lang }
}

/** Words the reader has looked up, with a short gloss for the hover tip. */
export function listLookedUp(): LookedUpWord[] {
  const saved = readSavedLookups()
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Record<string, DictionaryEntry | null>
    for (const [word, entry] of Object.entries(cached)) {
      if (saved[word] || !entry) continue
      const built = glossFromEntry(entry)
      if (built) saved[word] = built
    }
  } catch {
    // A broken dictionary cache still leaves the words saved from the panel.
  }
  return Object.entries(saved)
    .map(([word, item]) => ({ word, gloss: displayGloss(item) }))
    .filter((item) => item.word && item.gloss)
}

/** Remember a looked-up word so the reader can underline it. */
export function rememberLookup(word: string, saved: SavedLookup): void {
  const key = normalizeWord(word)
  const gloss = saved.gloss.replace(/\s+/g, ' ').trim().slice(0, 240)
  const native = (saved.native ?? saved.zh)?.replace(/\s+/g, ' ').trim().slice(0, 240)
  const lang = saved.lang ?? (saved.zh ? 'zh' : glossLanguage())
  if (!key || (!gloss && !native)) return
  const all = readSavedLookups()
  const prev = all[key]
  const prevNative = prev?.native ?? prev?.zh
  if (prev && prev.gloss === gloss && prevNative === native && (prev.lang ?? 'zh') === lang) return
  all[key] = {
    gloss,
    native: native || undefined,
    lang: native ? lang : undefined,
    zh: lang === 'zh' ? native || undefined : undefined,
  }
  try {
    localStorage.setItem(LOOKED_KEY, JSON.stringify(all))
  } catch {
    return
  }
  window.dispatchEvent(new Event(LOOKED_EVENT))
}

export function useLookups(): LookedUpWord[] {
  const [words, setWords] = useState(listLookedUp)
  useEffect(() => {
    const reload = () => setWords(listLookedUp())
    window.addEventListener(LOOKED_EVENT, reload)
    i18n.on('languageChanged', reload)
    return () => {
      window.removeEventListener(LOOKED_EVENT, reload)
      i18n.off('languageChanged', reload)
    }
  }, [])
  return words
}

/** Gloss in the current interface language. Cached in this browser, one entry per language. */
export async function translateGloss(text: string, signal: AbortSignal): Promise<string> {
  const source = text.replace(/\s+/g, ' ').trim()
  if (!source) return ''
  const cached = readGloss(source)
  if (cached) return cached
  const result = await translate(source, signal)
  const gloss = result.translated.trim()
  if (gloss) writeGloss(source, gloss)
  return gloss
}

