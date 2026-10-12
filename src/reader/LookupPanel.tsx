import { useEffect, useRef, useState } from 'react'
import type { TouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { isSingleEnglishWord, lookup, LookupError } from '../lib/lookup'
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

  useEffect(() => {
    const controller = new AbortController()
    lookup(text, controller.signal)
      .then((result) => setState({ kind: 'done', result }))
      .catch((error) => {
        if (controller.signal.aborted) return
        console.error(error)
        const message = error instanceof LookupError ? error.message : '查询失败，请稍后再试。'
        setState({ kind: 'error', message })
      })
    return () => controller.abort()
  }, [text])

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
      aria-label={shownAsDictionary ? '查词' : '翻译'}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="sheet-handle" />
      <header className="lookup-header">
        <span className="card-label">{shownAsDictionary ? '查词 · DICTIONARY' : '翻译 · TRANSLATE'}</span>
        <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="lookup-body" ref={bodyRef}>
        {state.kind === 'loading' && <p className="lookup-note">正在查询…</p>}
        {state.kind === 'error' && <p className="lookup-note error">{state.message}</p>}
        {state.kind === 'done' && <LookupContent result={state.result} />}
      </div>
    </aside>,
    document.body,
  )
}

function LookupContent({ result }: { result: LookupResult }) {
  if (result.kind === 'translation') {
    return (
      <>
        {result.notice && <p className="lookup-note">{result.notice}</p>}
        <p className="lookup-original">{result.source}</p>
        <p className="lookup-translation">{result.translated}</p>
        {result.truncated && <p className="lookup-note">选中的文字太长，只翻译了前一部分。</p>}
        <p className="lookup-source">翻译来自 MyMemory</p>
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
                  aria-label={`播放发音 ${p.text}`}
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
                {d.example && <p className="lookup-example">“{d.example}”</p>}
              </li>
            ))}
          </ol>
        </section>
      ))}
      <p className="lookup-source">释义来自 Free Dictionary API</p>
    </>
  )
}
