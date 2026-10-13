import { useEffect, useRef, useState } from 'react'
import type { TouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { isSingleEnglishWord, lookup, LookupError, translateGloss } from '../lib/lookup'
import type { LookupResult } from '../lib/lookup'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; result: LookupResult }

const CLOSE_DRAG_DISTANCE = 80
const SHEET_QUERY = '(max-width: 899px)'

/** Bottom sheet on narrow screens, right-hand side panel on wide ones. Remount (via `key`) for new text. */
export function LookupPanel({ text, onClose }: { text: string; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [drag, setDrag] = useState(0)
  const panelRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef<number | null>(null)
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

  function onTouchStart(e: TouchEvent) {
    if (!window.matchMedia(SHEET_QUERY).matches) return
    const body = bodyRef.current
    // Let the content scroll normally; only drag the sheet once it is scrolled to the top.
    if (body && body.scrollTop > 0 && body.contains(e.target as Node)) return
    dragStart.current = e.touches[0].clientY
  }

  function onTouchMove(e: TouchEvent) {
    if (dragStart.current === null) return
    setDrag(Math.max(0, e.touches[0].clientY - dragStart.current))
  }

  function onTouchEnd() {
    if (dragStart.current === null) return
    dragStart.current = null
    if (drag > CLOSE_DRAG_DISTANCE) onClose()
    else setDrag(0)
  }

  const isWord = isSingleEnglishWord(text)
  const shownAsDictionary = state.kind === 'done' ? state.result.kind === 'dictionary' : isWord

  return createPortal(
    <aside
      ref={panelRef}
      className={`lookup-panel${drag > 0 ? ' dragging' : ''}`}
      style={drag > 0 ? { transform: `translateY(${drag}px)` } : undefined}
      aria-label={shownAsDictionary ? t('toolbar.lookup') : t('toolbar.translate')}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="sheet-handle" />
      <header className="lookup-header">
        <span className="card-label">{shownAsDictionary ? t('lookup.dictionary') : t('lookup.translate')}</span>
        <button type="button" className="icon-button" aria-label={t('lookup.close')} onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="lookup-body" ref={bodyRef}>
        {state.kind === 'loading' && <p className="lookup-note">{t('lookup.loading')}</p>}
        {state.kind === 'error' && <p className="lookup-note error">{state.message}</p>}
        {state.kind === 'done' && <LookupContent result={state.result} />}
      </div>
    </aside>,
    document.body,
  )
}

function LookupContent({ result }: { result: LookupResult }) {
  const { t, i18n } = useTranslation()
  const bilingual = i18n.language.startsWith('zh')
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

  if (result.kind === 'translation') {
    return (
      <>
        {result.notice && <p className="lookup-note">{result.notice}</p>}
        <p className="lookup-original">{result.source}</p>
        <p className="lookup-translation">{result.translated}</p>
        {result.truncated && <p className="lookup-note">{t('lookup.tooLong')}</p>}
        <p className="lookup-source">{t('lookup.fromMemory')}</p>
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
