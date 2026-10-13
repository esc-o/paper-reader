import type { TextRange } from '../lib/types'

/** A rectangle in document coordinates (it scrolls with the page). */
export type Anchor = { top: number; bottom: number; left: number; right: number }

export type PendingSelection = {
  ranges: TextRange[]
  text: string
  anchor: Anchor
}

export function anchorFromRect(rect: DOMRect): Anchor {
  return {
    top: rect.top + window.scrollY,
    bottom: rect.bottom + window.scrollY,
    left: rect.left + window.scrollX,
    right: rect.right + window.scrollX,
  }
}

export function anchorFromPoint(clientX: number, clientY: number): Anchor {
  const x = clientX + window.scrollX
  const y = clientY + window.scrollY
  return { top: y - 12, bottom: y + 12, left: x, right: x }
}

export function hasTextSelection(): boolean {
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed
}

export function clearBrowserSelection() {
  window.getSelection()?.removeAllRanges()
}

/**
 * Converts the browser selection inside `container` into offsets within paragraphs.
 * Paragraph text elements are marked with `data-paragraph-id`. A full paragraph's
 * text content matches the paragraph. A screen-page slice sets `data-char-offset`
 * to where that slice starts in the paragraph.
 */
export function readSelection(container: HTMLElement | null): PendingSelection | null {
  const selection = window.getSelection()
  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null

  const ranges: TextRange[] = []
  const texts: string[] = []
  container.querySelectorAll<HTMLElement>('[data-paragraph-id]').forEach((el) => {
    if (!range.intersectsNode(el)) return
    const text = el.textContent ?? ''
    let start = el.contains(range.startContainer)
      ? offsetWithin(el, range.startContainer, range.startOffset)
      : 0
    let end = el.contains(range.endContainer)
      ? offsetWithin(el, range.endContainer, range.endOffset)
      : text.length
    while (start < end && /\s/.test(text[start])) start++
    while (end > start && /\s/.test(text[end - 1])) end--
    const base = Number(el.dataset.charOffset ?? 0)
    if (end > start) {
      ranges.push({ paragraphId: Number(el.dataset.paragraphId), start: start + base, end: end + base })
      texts.push(text.slice(start, end))
    }
  })

  if (ranges.length === 0) return null
  return { ranges, text: texts.join(' '), anchor: anchorFromRect(range.getBoundingClientRect()) }
}

function offsetWithin(element: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.setEnd(node, offset)
  return range.toString().length
}
