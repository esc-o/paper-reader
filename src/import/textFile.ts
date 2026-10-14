import type { Paragraph } from '../pdf/extractParagraphs'
import { finalizeParagraphs } from '../lib/toc'
import type { TocEntry } from '../lib/toc'

const PAGE_CHARS = 1800

export class TextImportError extends Error {
  code: 'encrypted' | 'unsupported' | 'empty' | 'invalid'

  constructor(code: 'encrypted' | 'unsupported' | 'empty' | 'invalid') {
    super(code)
    this.code = code
  }
}

export type ExtractedText = {
  title: string
  author: string
  numPages: number
  paragraphs: Paragraph[]
  toc: TocEntry[]
  pageOffset: number
}

export function extractTxt(data: Uint8Array, fileName: string): ExtractedText {
  const text = decodeText(data)
  return layoutText(text, fileName.replace(/\.txt$/i, ''))
}

export function extractMobi(data: Uint8Array, fileName: string): ExtractedText {
  const raw = mobiText(data)
  const text = raw.html ? htmlToText(raw.html) : raw.plain
  return layoutText(text, raw.title || fileName.replace(/\.mobi$/i, ''), raw.author)
}

function layoutText(text: string, fallbackTitle: string, author = ''): ExtractedText {
  const blocks = paragraphsFrom(text)
  if (blocks.length === 0) throw new TextImportError('empty')
  const first = blocks[0]
  const titleBlock = !!first?.heading && first.text.length < 120 && !isNumberedChapter(first.text)
  const titled = titleBlock ? first.text : ''
  const body = titleBlock ? blocks.slice(1) : blocks
  const source = body.length > 0 ? body : blocks
  let page = 1
  let used = 0
  const paragraphs: Paragraph[] = source.map((block, index) => {
    if (used > 0 && used + block.text.length > PAGE_CHARS) {
      page += 1
      used = 0
    }
    used += block.text.length
    return {
      id: index,
      text: block.text,
      startPage: page,
      endPage: page,
      isHeading: block.heading,
    }
  })
  const laid = finalizeParagraphs(paragraphs, page)
  return {
    title: titled || fallbackTitle,
    author,
    numPages: page,
    paragraphs: laid.paragraphs,
    toc: laid.toc,
    pageOffset: laid.pageOffset,
  }
}

function paragraphsFrom(text: string): { text: string; heading: boolean }[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\u0000/g, '').trim()
  if (!normalized) return []
  const blankSplit = normalized.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
  const parts = blankSplit.length > 1 ? blankSplit : normalized.split('\n').map((line) => line.trim()).filter(Boolean)
  return parts.map((part) => {
    const cleaned = part.replace(/^#{1,6}\s+/, '').replace(/\s*\n\s*/g, ' ').trim()
    return { text: cleaned, heading: isChapterHeading(part) }
  }).filter((part) => part.text.length > 0)
}

function isNumberedChapter(text: string): boolean {
  return /^(chapter|part|section)\s+[0-9ivx]+|第[0-9一二三四五六七八九十百千]+/i.test(text)
}

function isChapterHeading(text: string): boolean {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length > 80) return false
  return /^(#{1,6}\s+\S|(chapter|part|section)\s+[0-9ivx]+|第[0-9一二三四五六七八九十百千]+[章节部卷篇])/i.test(line)
}

function decodeText(data: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(data)
  const bad = (utf8.match(/\uFFFD/g) ?? []).length
  if (bad === 0 || bad < utf8.length / 50) return utf8.replace(/^\uFEFF/, '')
  try {
    return new TextDecoder('gb18030').decode(data).replace(/^\uFEFF/, '')
  } catch {
    return utf8.replace(/^\uFEFF/, '')
  }
}

function mobiText(data: Uint8Array): { html: string; plain: string; title: string; author: string } {
  if (data.length < 100) throw new TextImportError('invalid')
  const records = recordOffsets(data)
  if (records.length < 2) throw new TextImportError('invalid')
  const header = sliceRecord(data, records, 0)
  const compression = u16(header, 0)
  const textLength = u32(header, 4)
  const textRecords = u16(header, 8)
  const encryption = u16(header, 12)
  if (encryption !== 0) throw new TextImportError('encrypted')
  if (compression !== 1 && compression !== 2) throw new TextImportError('unsupported')
  const flags = header.length >= 16 + 0xf4 && ascii(header, 16, 4) === 'MOBI' ? u32(header, 16 + 0xf0) : 0
  const encoding = header.length >= 16 + 16 && ascii(header, 16, 4) === 'MOBI' ? u32(header, 16 + 0x0c) : 65001
  const title = mobiTitle(header)
  const author = mobiAuthor(header)
  const chunks: Uint8Array[] = []
  const count = Math.min(textRecords, records.length - 1)
  for (let index = 1; index <= count; index += 1) {
    let chunk = sliceRecord(data, records, index)
    if (flags) chunk = stripTrailers(chunk, flags)
    chunks.push(compression === 2 ? palmdoc(chunk) : chunk)
  }
  const merged = concat(chunks)
  const bytes = merged.subarray(0, Math.min(textLength || merged.length, merged.length))
  const html = encoding === 1252 ? new TextDecoder('windows-1252').decode(bytes) : decodeText(bytes)
  return { html, plain: '', title, author }
}

function recordOffsets(data: Uint8Array): number[] {
  const count = u16(data, 76)
  const offsets: number[] = []
  for (let index = 0; index < count; index += 1) offsets.push(u32(data, 78 + index * 8))
  offsets.push(data.length)
  return offsets
}

function sliceRecord(data: Uint8Array, offsets: number[], index: number): Uint8Array {
  const start = offsets[index] ?? 0
  const end = offsets[index + 1] ?? data.length
  if (start >= end || end > data.length) throw new TextImportError('invalid')
  return data.subarray(start, end)
}

function palmdoc(src: Uint8Array): Uint8Array {
  const out: number[] = []
  let i = 0
  while (i < src.length) {
    const code = src[i++]
    if (code === 0 || (code >= 9 && code <= 0x7f)) out.push(code)
    else if (code <= 8) {
      for (let n = 0; n < code && i < src.length; n += 1) out.push(src[i++])
    } else if (code <= 0xbf) {
      if (i >= src.length) break
      const next = src[i++]
      const distance = (((code & 0x3f) << 8) | next) >> 3
      const length = (next & 7) + 3
      if (distance <= 0 || distance > out.length) continue
      for (let n = 0; n < length; n += 1) out.push(out[out.length - distance])
    } else {
      out.push(32, code ^ 0x80)
    }
  }
  return Uint8Array.from(out)
}

function stripTrailers(data: Uint8Array, flags: number): Uint8Array {
  let extra = 0
  for (let bit = 15; bit > 0; bit -= 1) {
    if ((flags & (1 << bit)) === 0) continue
    for (let step = 0; step < 4; step += 1) {
      const byte = data[data.length - 1 - extra]
      extra += 1
      if ((byte & 0x80) === 0) break
    }
  }
  if (flags & 1) {
    const mark = data[data.length - 1 - extra] ?? 0
    extra += (mark & 0x3) + 1
  }
  return data.subarray(0, Math.max(0, data.length - extra))
}

function mobiTitle(header: Uint8Array): string {
  if (ascii(header, 16, 4) !== 'MOBI' || header.length < 16 + 0x4c) return ''
  const offset = u32(header, 16 + 0x44)
  const length = u32(header, 16 + 0x48)
  if (offset <= 0 || length <= 0 || offset + length > header.length) return ''
  return decodeText(header.subarray(offset, offset + length)).replace(/\u0000/g, '').trim()
}

function mobiAuthor(header: Uint8Array): string {
  if (ascii(header, 16, 4) !== 'MOBI') return ''
  const headerLength = u32(header, 20)
  const exth = 16 + headerLength
  if (ascii(header, exth, 4) !== 'EXTH') return ''
  const count = u32(header, exth + 8)
  let cursor = exth + 12
  for (let index = 0; index < count && cursor + 8 <= header.length; index += 1) {
    const type = u32(header, cursor)
    const length = u32(header, cursor + 4)
    if (length < 8 || cursor + length > header.length) break
    if (type === 100) return decodeText(header.subarray(cursor + 8, cursor + length)).replace(/\u0000/g, '').trim()
    cursor += length
  }
  return ''
}

function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<mbp:pagebreak[^>]*>/gi, '\n\n')
  const broken = withoutNoise
    .replace(/<h([1-6])[^>]*>/gi, '\n\n# ')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|blockquote)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '\n')
  const stripped = broken.replace(/<[^>]+>/g, '')
  return decodeEntities(stripped)
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value: string) => String.fromCodePoint(parseInt(value, 16)))
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  let text = ''
  for (let index = 0; index < length && offset + index < data.length; index += 1) text += String.fromCharCode(data[offset + index])
  return text
}

function u16(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)
}

function u32(data: Uint8Array, offset: number): number {
  return (
    (((data[offset] ?? 0) << 24) |
      ((data[offset + 1] ?? 0) << 16) |
      ((data[offset + 2] ?? 0) << 8) |
      (data[offset + 3] ?? 0)) >>>
    0
  )
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
