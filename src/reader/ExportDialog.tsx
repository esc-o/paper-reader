import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { exportNotes, ExportError } from '../lib/exportDocx'
import type { ExportOptions } from '../lib/exportDocx'
import { HIGHLIGHT_COLORS } from '../lib/types'
import type { Annotation, Book, HighlightColor } from '../lib/types'
import './ExportDialog.css'

export function ExportDialog({
  book,
  annotations,
  onClose,
}: {
  book: Book
  annotations: Annotation[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [all, setAll] = useState(true)
  const [commentsOnly, setCommentsOnly] = useState(false)
  const [colors, setColors] = useState<HighlightColor[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nothingChosen = !all && !commentsOnly && colors.length === 0

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function toggleColor(color: HighlightColor) {
    setAll(false)
    setColors((current) => (current.includes(color) ? current.filter((item) => item !== color) : [...current, color]))
  }

  async function confirm() {
    const options: ExportOptions = { all, commentsOnly, colors }
    setBusy(true)
    setMessage(null)
    try {
      await exportNotes(book, annotations, options)
      onClose()
    } catch (error) {
      console.error(error)
      setMessage(error instanceof ExportError ? error.message : t('export.failed'))
      setBusy(false)
    }
  }

  return createPortal(
    <div className="export-scrim" onMouseDown={onClose}>
      <div
        className="export-dialog"
        role="dialog"
        aria-labelledby="export-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="export-title">{t('export.title')}</h2>
        <p className="export-book">{book.title}</p>
        <label className="export-check">
          <input
            type="checkbox"
            checked={all}
            onChange={(event) => {
              setAll(event.target.checked)
              if (event.target.checked) {
                setCommentsOnly(false)
                setColors([])
              }
            }}
          />
          {t('export.all')}
        </label>
        <label className={`export-check${all ? ' disabled' : ''}`}>
          <input
            type="checkbox"
            checked={commentsOnly}
            disabled={all}
            onChange={(event) => setCommentsOnly(event.target.checked)}
          />
          {t('export.commentsOnly')}
        </label>
        <fieldset className="export-colors" disabled={all}>
          <legend>{t('export.colors')}</legend>
          <div className="export-swatches">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`swatch swatch-${color}${colors.includes(color) ? ' selected' : ''}`}
                aria-pressed={colors.includes(color)}
                aria-label={t(`colors.${color}`)}
                disabled={all}
                onClick={() => toggleColor(color)}
              />
            ))}
          </div>
        </fieldset>
        {message && <p className="export-message">{message}</p>}
        <div className="export-actions">
          <button type="button" className="text-button" onClick={onClose}>
            {t('export.cancel')}
          </button>
          <button type="button" className="solid-button" disabled={busy || nothingChosen} onClick={confirm}>
            {busy ? t('export.exporting') : t('export.word')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
