import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { glossLanguage, isSingleEnglishWord, lookup, LookupError, rememberLookup, translateGloss } from '../lib/lookup'
import type { LookupResult } from '../lib/lookup'
import type { Anchor } from './selection'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; result: LookupResult }

/** A card beside the selected words. Remount (via `key`) for new text. */
export function LookupPanel({ text, anchor, onClose }: { text: string; anchor: Anchor; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const panelRef = useRef<HTMLElement>(null)
  const { t } = useTranslation()

  useEffect(() => {
    const controller = new AbortController()
    lookup(text, controller.signal)
      .then((result) => setState({ kind: 'done', result }))
      .catch((error) => {
        if (controller.signal.aborted) return
        console.error(error)
        const message = error instanceof LookupError ? error.message : t('lookup.failed')
        setState({ kind: 'error', message })
      })
    return () => controller.abort()
  }, [text, t])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element
      if (panelRef.current?.contains(target) || target.closest('[data-keep-panel], .floating')) return
      onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  useLayoutEffect(() => {
    const card = panelRef.current
    if (!card) return
    const place = (event?: Event) => {
      if (event?.target instanceof Node && card.contains(event.target)) return
      const margin = 8
      const box = card.getBoundingClientRect()
      const topView = anchor.top - window.scrollY
      const bottomView = anchor.bottom - window.scrollY
      const leftView = anchor.left - window.scrollX
      let top = bottomView + margin
      if (top + box.height > window.innerHeight - margin) top = topView - box.height - margin
      if (top < margin) top = Math.max(margin, window.innerHeight - box.height - margin)
      let left = leftView
      if (left + box.width > window.innerWidth - margin) left = window.innerWidth - box.width - margin
      if (left < margin) left = margin
      card.style.top = `${top}px`
      card.style.left = `${left}px`
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchor, state])

  const isWord = isSingleEnglishWord(text)
  const shownAsDictionary = state.kind === 'done' ? state.result.kind === 'dictionary' : isWord

  return createPortal(
    <aside
      ref={panelRef}
      className="lookup-panel"
      aria-label={shownAsDictionary ? t('toolbar.lookup') : t('toolbar.translate')}
    >
      <header className="lookup-header">
        <span className="card-label">{shownAsDictionary ? t('lookup.dictionary') : t('lookup.translate')}</span>
        <button type="button" className="icon-button" aria-label={t('lookup.close')} onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="lookup-body">
        {state.kind === 'loading' && <p className="lookup-note">{t('lookup.loading')}</p>}
        {state.kind === 'error' && <p className="lookup-note error">{state.message}</p>}
        {state.kind === 'done' && <LookupContent result={state.result} />}
      </div>
    </aside>,
    document.body,
  )
}

function LookupContent({ result }: { result: LookupResult }) {
  const { t } = useTranslation()
  const bilingual = glossLanguage() !== 'en'
  const [glosses, setGlosses] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!bilingual || result.kind !== 'dictionary') return
    const definitions = result.entry.meanings.flatMap((meaning) =>
      meaning.definitions.slice(0, 5).map((item) => item.definition),
    )
    const unique = [...new Set(definitions.map((text) => text.trim()).filter(Boolean))]
    const controller = new AbortController()
    void (async () => {
      const next: Record<string, string> = {}
      for (const text of unique) {
        if (controller.signal.aborted) return
        try {
          const gloss = await translateGloss(text, controller.signal)
          if (gloss && gloss.localeCompare(text, undefined, { sensitivity: 'accent' }) !== 0) next[text] = gloss
        } catch {
          // Keep the English line when a gloss cannot be fetched.
        }
        if (!controller.signal.aborted) setGlosses({ ...next })
      }
    })()
    return () => controller.abort()
  }, [bilingual, result])

  useEffect(() => {
    if (result.kind === 'translation') {
      if (!isSingleEnglishWord(result.source)) return
      rememberLookup(result.source, { gloss: '', native: result.translated, lang: glossLanguage() })
      return
    }
    const meaning = result.entry.meanings[0]
    const definition = meaning?.definitions[0]?.definition?.trim()
    if (!definition) return
    const gloss = meaning.partOfSpeech ? `${meaning.partOfSpeech} · ${definition}` : definition
    rememberLookup(result.entry.word, { gloss, native: glosses[definition], lang: glossLanguage() })
  }, [glosses, result])

  if (result.kind === 'translation') {
    return (
      <>
        {result.notice && <p className="lookup-note">{result.notice}</p>}
        <p className="lookup-original">{result.source}</p>
        {result.translated !== result.source && <p className="lookup-translation">{result.translated}</p>}
        {result.truncated && <p className="lookup-note">{t('lookup.tooLong')}</p>}
        {!result.local && <p className="lookup-source">{t('lookup.fromMemory')}</p>}
      </>
    )
  }

  const { entry } = result
  return (
    <>
      <h2 className="lookup-word">{entry.word}</h2>
      {entry.phonetics.length > 0 && (
        <p className="lookup-phonetics">
          {entry.phonetics.map((p) => (
            <span key={p.text} className="phonetic">
              {p.text}
              {p.audio && (
                <button
                  type="button"
                  className="icon-button small"
                  aria-label={t('lookup.play', { text: p.text })}
                  onClick={() => new Audio(p.audio).play()}
                >
                  ▶
                </button>
              )}
            </span>
          ))}
        </p>
      )}
      {entry.meanings.map((m) => (
        <section key={m.partOfSpeech} className="lookup-meaning">
          <h3 className="lookup-pos">{m.partOfSpeech}</h3>
          <ol>
            {m.definitions.slice(0, 5).map((d, i) => (
              <li key={i}>
                {d.definition}
                {bilingual && glosses[d.definition.trim()] && (
                  <p className="lookup-gloss">{glosses[d.definition.trim()]}</p>
                )}
                {d.example && <p className="lookup-example">“{d.example}”</p>}
              </li>
            ))}
          </ol>
        </section>
      ))}
      <p className="lookup-source">{t('lookup.fromSource', { source: entry.source })}</p>
    </>
  )
}
