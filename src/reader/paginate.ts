import type { Paragraph } from '../pdf/extractParagraphs'

export type TextSlice = {
  paragraph: Paragraph
  start: number
  end: number
}

export type ScreenPage = {
  slices: TextSlice[]
}

export type ReadAnchor = {
  paragraphId: number
  charOffset: number
}

type Options = {
  container: HTMLElement
  contentWidth: number
  contentHeight: number
}

/** Splits body text into screen-sized pages using the reader's current type. */
export function paginateParagraphs(paragraphs: Paragraph[], options: Options): ScreenPage[] {
  const visible = paragraphs.filter((paragraph) => !paragraph.isToc && paragraph.text.length > 0)
  const measurer = document.createElement('div')
  measurer.setAttribute('aria-hidden', 'true')
  measurer.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;width:${options.contentWidth}px;z-index:-1;`

  const body = document.createElement('div')
  body.className = 'paragraph'
  const bodyText = document.createElement('p')
  bodyText.className = 'paragraph-text'
  body.append(bodyText)

  const heading = document.createElement('div')
  heading.className = 'paragraph heading'
  const headingText = document.createElement('h3')
  headingText.className = 'paragraph-text'
  heading.append(headingText)

  measurer.append(body, heading)
  options.container.append(measurer)

  function heightOf(text: string, isHeading: boolean): number {
    const block = isHeading ? heading : body
    const node = isHeading ? headingText : bodyText
    body.style.display = isHeading ? 'none' : ''
    heading.style.display = isHeading ? '' : 'none'
    node.textContent = text
    return block.offsetHeight
  }

  const pages: ScreenPage[] = []
  let slices: TextSlice[] = []
  let used = 0
  const limit = options.contentHeight

  function flush() {
    if (slices.length === 0) return
    pages.push({ slices })
    slices = []
    used = 0
  }

  try {
    for (const paragraph of visible) {
      let cursor = 0
      const full = paragraph.text
      while (cursor < full.length) {
        const room = limit - used
        const one = heightOf(full.slice(cursor, cursor + 1), paragraph.isHeading)
        if (slices.length > 0 && one > room) {
          flush()
          continue
        }
        let end = fitEnd(full, cursor, Math.max(room, one), paragraph.isHeading, heightOf)
        if (end <= cursor) end = Math.min(full.length, cursor + 1)
        end = preferBreak(full, cursor, end)
        const chunk = full.slice(cursor, end)
        slices.push({ paragraph, start: cursor, end })
        used += heightOf(chunk, paragraph.isHeading)
        cursor = end
        if (used >= limit - 1) flush()
      }
    }
    flush()
  } finally {
    measurer.remove()
  }

  if (pages.length === 0) pages.push({ slices: [] })
  return pages
}

function fitEnd(
  full: string,
  cursor: number,
  room: number,
  isHeading: boolean,
  heightOf: (text: string, isHeading: boolean) => number,
): number {
  let lo = cursor + 1
  let hi = full.length
  let best = cursor
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (heightOf(full.slice(cursor, mid), isHeading) <= room) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

function preferBreak(full: string, start: number, end: number): number {
  if (end >= full.length || end <= start) return end
  const slice = full.slice(start, end)
  const space = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'))
  if (space <= slice.length * 0.55) return end
  let next = start + space + 1
  while (next < end && full[next] === ' ') next++
  return next > start ? next : end
}

export function pageIndexForAnchor(pages: ScreenPage[], anchor: ReadAnchor | null, pdfPage: number): number {
  if (anchor) {
    const match = pages.findIndex((page) =>
      page.slices.some((slice) => sliceContains(slice, anchor.paragraphId, anchor.charOffset)),
    )
    if (match >= 0) return match
  }
  return indexForPdf(pages, pdfPage)
}

export function indexForPdf(pages: ScreenPage[], pdfPage: number): number {
  const exact = pages.findIndex((page) => page.slices.some((slice) => slice.paragraph.startPage === pdfPage))
  if (exact >= 0) return exact
  const after = pages.findIndex((page) => page.slices.some((slice) => slice.paragraph.startPage > pdfPage))
  if (after >= 0) return after
  return Math.max(0, pages.length - 1)
}

function sliceContains(slice: TextSlice, paragraphId: number, offset: number): boolean {
  if (slice.paragraph.id !== paragraphId || offset < slice.start) return false
  if (offset < slice.end) return true
  return offset === slice.end && slice.end === slice.paragraph.text.length
}

export function anchorOf(page: ScreenPage | undefined): ReadAnchor | null {
  const slice = page?.slices[0]
  if (!slice) return null
  return { paragraphId: slice.paragraph.id, charOffset: slice.start }
}
