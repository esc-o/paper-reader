import { ImageKind, OPS } from 'pdfjs-dist'
import type { PDFPageProxy } from 'pdfjs-dist'

export type PageFigure = {
  /** Left edge in PDF points. */
  x: number
  /** Bottom edge in PDF points. */
  y: number
  /** Top edge in PDF points. */
  top: number
  boxWidth: number
  boxHeight: number
  src: string
  width: number
  height: number
}

type RawImage = {
  width?: number
  height?: number
  kind?: number
  data?: Uint8Array | Uint8ClampedArray
  bitmap?: ImageBitmap
}

const MIN_SIDE = 48
const MAX_PIXEL = 2400

/** Illustrations painted on this page, in their original pixels. */
export async function figuresOnPage(page: PDFPageProxy, pageWidth: number, pageHeight: number): Promise<PageFigure[]> {
  let opList
  try {
    opList = await page.getOperatorList()
  } catch {
    return []
  }

  const found: PageFigure[] = []
  const seen = new Set<string>()
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack: number[][] = []

  for (let index = 0; index < opList.fnArray.length; index++) {
    const fn = opList.fnArray[index]
    const args = opList.argsArray[index] as unknown[] | null
    if (fn === OPS.save || fn === OPS.beginGroup || fn === OPS.beginAnnotation) {
      stack.push(ctm)
      continue
    }
    if (fn === OPS.restore || fn === OPS.endGroup || fn === OPS.endAnnotation) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]
      continue
    }
    if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm)
      const matrix = args?.[0]
      if (Array.isArray(matrix) && matrix.length >= 6) ctm = multiply(ctm, matrix as number[])
      continue
    }
    if (fn === OPS.paintFormXObjectEnd) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]
      continue
    }
    if (fn === OPS.transform) {
      if (Array.isArray(args) && args.length >= 6) ctm = multiply(ctm, args as number[])
      continue
    }
    if (fn !== OPS.paintImageXObject && fn !== OPS.paintInlineImageXObject) continue

    const box = imageBox(ctm)
    if (box.width < MIN_SIDE || box.height < MIN_SIDE) continue
    if (box.width > pageWidth * 0.97 && box.height > pageHeight * 0.97) continue
    const key = `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.width)}:${Math.round(box.height)}`
    if (seen.has(key)) continue

    const image = await imageAt(page, args?.[0])
    const painted = image ? paintImage(image) : null
    if (!painted || looksBlank(painted)) continue
    seen.add(key)
    found.push({
      x: box.x,
      y: box.y,
      top: box.y + box.height,
      boxWidth: box.width,
      boxHeight: box.height,
      src: painted.toDataURL('image/png'),
      width: painted.width,
      height: painted.height,
    })
  }

  return found
}

/** A mark that sits in the same corner of many pages is a logo, not an illustration. */
export function dropRepeatedFigures(pages: { width: number; height: number; figures: PageFigure[] }[]): void {
  const counts = new Map<string, number>()
  const keys = pages.map((page) =>
    page.figures.map((figure) => {
      const key = slotKey(figure, page.width, page.height)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      return key
    }),
  )
  const limit = pages.length <= 2 ? 2 : 3
  pages.forEach((page, index) => {
    page.figures = page.figures.filter((figure, figureIndex) => {
      const key = keys[index][figureIndex]
      if ((counts.get(key) ?? 0) >= limit) return false
      const mid = figure.y + figure.boxHeight / 2
      return mid < page.height * 0.9 && mid > page.height * 0.1
    })
  })
}

function slotKey(figure: PageFigure, pageWidth: number, pageHeight: number): string {
  const cx = Math.round(((figure.x + figure.boxWidth / 2) / pageWidth) * 16)
  const cy = Math.round(((figure.y + figure.boxHeight / 2) / pageHeight) * 16)
  const w = Math.round(figure.boxWidth / 24)
  const h = Math.round(figure.boxHeight / 24)
  return `${cx}:${cy}:${w}:${h}`
}

function imageBox(ctm: number[]): { x: number; y: number; width: number; height: number } {
  const [a, b, c, d, e, f] = ctm
  const corners = [
    [e, f],
    [a + e, b + f],
    [c + e, d + f],
    [a + c + e, b + d + f],
  ]
  const xs = corners.map((point) => point[0])
  const ys = corners.map((point) => point[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

function multiply(m1: number[], m2: number[]): number[] {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

async function imageAt(page: PDFPageProxy, arg: unknown): Promise<RawImage | null> {
  if (arg && typeof arg === 'object') return arg as RawImage
  if (typeof arg !== 'string') return null
  const store = page.objs.has(arg) ? page.objs : page.commonObjs.has(arg) ? page.commonObjs : null
  if (!store) return null
  try {
    return await new Promise((resolve) => store.get(arg, (value: RawImage) => resolve(value ?? null)))
  } catch {
    return null
  }
}

function paintImage(image: RawImage): HTMLCanvasElement | null {
  const width = image.width ?? image.bitmap?.width ?? 0
  const height = image.height ?? image.bitmap?.height ?? 0
  if (width < 8 || height < 8) return null
  const scale = Math.min(1, MAX_PIXEL / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  if (image.bitmap) {
    ctx.drawImage(image.bitmap, 0, 0, canvas.width, canvas.height)
    return canvas
  }
  if (!image.data) return null

  const rgba =
    image.kind === ImageKind.RGBA_32BPP
      ? rgbaFromPacked(image.data, width, height, 4)
      : image.kind === ImageKind.RGB_24BPP
        ? rgbaFromPacked(image.data, width, height, 3)
        : image.kind === ImageKind.GRAYSCALE_1BPP
          ? rgbaFrom1bpp(image.data, width, height)
          : null
  if (!rgba) return null

  const full = document.createElement('canvas')
  full.width = width
  full.height = height
  const fullCtx = full.getContext('2d')
  if (!fullCtx) return null
  fullCtx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
  ctx.drawImage(full, 0, 0, canvas.width, canvas.height)
  return canvas
}

function rgbaFromPacked(data: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: 3 | 4): Uint8ClampedArray | null {
  const pixels = width * height
  if (data.length < pixels * channels) return null
  if (channels === 4) return new Uint8ClampedArray(data.buffer, data.byteOffset, pixels * 4).slice()
  const rgba = new Uint8ClampedArray(pixels * 4)
  for (let i = 0; i < pixels; i++) {
    rgba[i * 4] = data[i * 3]
    rgba[i * 4 + 1] = data[i * 3 + 1]
    rgba[i * 4 + 2] = data[i * 3 + 2]
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

function rgbaFrom1bpp(data: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8ClampedArray | null {
  const rowBytes = Math.ceil(width / 8)
  if (data.length < rowBytes * height) return null
  const direct = bitsToRgba(data, width, height, rowBytes, false)
  const flipped = bitsToRgba(data, width, height, rowBytes, true)
  return darkSamples(direct) >= darkSamples(flipped) ? direct : flipped
}

function bitsToRgba(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  rowBytes: number,
  invert: boolean,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1
      const black = invert ? bit === 1 : bit === 0
      const value = black ? 0 : 255
      const pixel = (y * width + x) * 4
      rgba[pixel] = value
      rgba[pixel + 1] = value
      rgba[pixel + 2] = value
      rgba[pixel + 3] = 255
    }
  }
  return rgba
}

function darkSamples(rgba: Uint8ClampedArray): number {
  let dark = 0
  const step = Math.max(4, Math.floor(rgba.length / 4 / 400) * 4)
  for (let i = 0; i < rgba.length; i += step) {
    if (rgba[i] + rgba[i + 1] + rgba[i + 2] < 700) dark++
  }
  return dark
}

function looksBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d')
  if (!ctx) return true
  const { width, height } = canvas
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, width, height).data
  } catch {
    return false
  }
  const step = Math.max(1, Math.floor(Math.max(width, height) / 48))
  let dark = 0
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 20) continue
      if (data[i] + data[i + 1] + data[i + 2] < 720) dark++
    }
  }
  return dark < 6
}
