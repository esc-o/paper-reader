export type DictionaryEntry = {
  word: string
  phonetics: { text: string; audio?: string }[]
  meanings: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[]
}

export type LookupResult =
  | { kind: 'dictionary'; entry: DictionaryEntry }
  | { kind: 'translation'; source: string; translated: string; truncated: boolean; notice?: string }

export class LookupError extends Error {}

type RawEntry = {
  word: string
  phonetic?: string
  phonetics?: { text?: string; audio?: string }[]
  meanings?: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }[]
}

function stripPunctuation(text: string): string {
  return text.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
}

export function isSingleEnglishWord(text: string): boolean {
  return /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(stripPunctuation(text))
}

/**
 * Single English words go to the dictionary; anything else gets translated. Words the dictionary
 * doesn't know, or can't answer for right now, fall back to translation.
 */
export async function lookup(text: string, signal: AbortSignal): Promise<LookupResult> {
  if (!isSingleEnglishWord(text)) return translate(text, signal)

  try {
    const entry = await lookupWord(stripPunctuation(text), signal)
    if (entry) return { kind: 'dictionary', entry }
    return { ...(await translate(text, signal)), notice: '词典里没有这个词，下面是翻译结果。' }
  } catch (error) {
    if (signal.aborted || !(error instanceof LookupError)) throw error
    return { ...(await translate(text, signal)), notice: '词典服务暂时连不上，先显示翻译结果。' }
  }
}

const REQUEST_TIMEOUT_MS = 8000

async function request(url: string, signal: AbortSignal, service: string): Promise<Response> {
  try {
    return await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) })
  } catch (error) {
    if (signal.aborted) throw error
    throw new LookupError(`连不上${service}，请检查网络。`)
  }
}

async function lookupWord(word: string, signal: AbortSignal): Promise<DictionaryEntry | null> {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`
  const res = await request(url, signal, '词典服务')
  if (res.status === 404) return null
  if (!res.ok) throw new LookupError(`词典服务出错了（${res.status}），请稍后再试。`)

  const entries = (await res.json()) as RawEntry[]
  const phonetics = new Map<string, string | undefined>()
  const meanings = new Map<string, DictionaryEntry['meanings'][number]['definitions']>()
  for (const entry of entries) {
    if (entry.phonetic && !phonetics.has(entry.phonetic)) phonetics.set(entry.phonetic, undefined)
    for (const p of entry.phonetics ?? []) {
      if (p.text && !phonetics.get(p.text)) phonetics.set(p.text, p.audio || undefined)
    }
    for (const m of entry.meanings ?? []) {
      meanings.set(m.partOfSpeech, [...(meanings.get(m.partOfSpeech) ?? []), ...m.definitions])
    }
  }

  return {
    word: entries[0]?.word ?? word,
    phonetics: [...phonetics].map(([text, audio]) => ({ text, audio })),
    meanings: [...meanings].map(([partOfSpeech, definitions]) => ({ partOfSpeech, definitions })),
  }
}

// MyMemory rejects queries longer than 500 bytes.
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

  const params = new URLSearchParams({ q: query, langpair: 'en|zh-CN' })
  const res = await request(`https://api.mymemory.translated.net/get?${params}`, signal, '翻译服务')
  if (!res.ok) throw new LookupError(`翻译服务出错了（${res.status}），请稍后再试。`)

  const data = (await res.json()) as {
    responseStatus: number | string
    responseDetails?: string
    responseData?: { translatedText?: string }
  }
  const status = Number(data.responseStatus)
  if (status === 429) throw new LookupError('今天的免费翻译额度用完了，明天再试吧。')
  const translated = data.responseData?.translatedText
  if (status !== 200 || !translated) {
    throw new LookupError(data.responseDetails || '翻译失败，请稍后再试。')
  }

  const decoded = new DOMParser().parseFromString(translated, 'text/html').documentElement.textContent
  return { kind: 'translation', source: query, translated: decoded ?? translated, truncated }
}
