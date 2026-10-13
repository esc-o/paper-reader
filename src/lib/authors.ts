const DOI_PATTERN = /\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)/

type CrossrefAuthor = { given?: string; family?: string; name?: string }

export function usableAuthor(value: string): string {
  const author = value.trim()
  if (!author || /^(unknown|anonymous|n\/a|none)$/i.test(author)) return ''
  return author
}

export function doiInText(text: string): string | null {
  const match = text.match(DOI_PATTERN)
  if (!match) return null
  return match[1].replace(/[.)\],;]+$/, '')
}

/** Author names from Crossref. Empty when the DOI is missing or the request fails. */
export async function authorsForDoi(doi: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return ''
    const body = (await response.json()) as { message?: { author?: CrossrefAuthor[] } }
    const names = (body.message?.author ?? [])
      .map((author) => author.name?.trim() || [author.given, author.family].filter(Boolean).join(' ').trim())
      .filter(Boolean)
    return names.join(', ')
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}
