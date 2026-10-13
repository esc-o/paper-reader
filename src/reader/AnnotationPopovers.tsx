import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Annotation, HighlightColor } from '../lib/types'
import { ColorSwatches } from './ColorSwatches'
import { Floating } from './Floating'
import type { Anchor } from './selection'

function Quote({ text }: { text: string }) {
  return <blockquote className="popover-quote">{text.length > 140 ? text.slice(0, 140) + '…' : text}</blockquote>
}

function CommentEditor({
  initial = '',
  onSave,
  onCancel,
}: {
  initial?: string
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const trimmed = value.trim()
  const { t } = useTranslation()

  useEffect(() => {
    const el = ref.current
    el?.focus({ preventScroll: true })
    el?.setSelectionRange(el.value.length, el.value.length)
  }, [])

  return (
    <div className="comment-editor">
      <textarea
        ref={ref}
        value={value}
        rows={4}
        placeholder={t('comment.placeholder')}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && trimmed) onSave(trimmed)
        }}
      />
      <div className="popover-actions">
        <button type="button" className="text-button" onClick={onCancel}>
          {t('comment.cancel')}
        </button>
        <button type="button" className="solid-button" disabled={!trimmed} onClick={() => onSave(trimmed)}>
          {t('comment.save')}
        </button>
      </div>
    </div>
  )
}

export function NewCommentPopover({
  anchor,
  quote,
  onSave,
  onClose,
}: {
  anchor: Anchor
  quote: string
  onSave: (text: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Floating anchor={anchor} className="popover comment-popover" onClose={onClose}>
      <p className="popover-title">{t('comment.write')}</p>
      <Quote text={quote} />
      <CommentEditor onSave={onSave} onCancel={onClose} />
    </Floating>
  )
}

export function CommentPopover({
  anchor,
  annotation,
  onSave,
  onDelete,
  onClose,
}: {
  anchor: Anchor
  annotation: Annotation
  onSave: (text: string) => void
  onDelete: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)

  return (
    <Floating anchor={anchor} className="popover comment-popover" onClose={onClose}>
      <p className="popover-title">{t('comment.title')}</p>
      <Quote text={annotation.text} />
      {editing ? (
        <CommentEditor
          initial={annotation.comment}
          onSave={(text) => {
            onSave(text)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <p className="comment-text">{annotation.comment}</p>
          <div className="popover-actions">
            <button
              type="button"
              className="text-button danger"
              onClick={() => {
                if (window.confirm(t('comment.deleteConfirm'))) onDelete()
              }}
            >
              {t('comment.delete')}
            </button>
            <button type="button" className="solid-button" onClick={() => setEditing(true)}>
              {t('comment.edit')}
            </button>
          </div>
        </>
      )}
    </Floating>
  )
}

export function MarksPopover({
  anchor,
  annotations,
  onChangeColor,
  onDelete,
  onClose,
}: {
  anchor: Anchor
  annotations: Annotation[]
  onChangeColor: (id: string, color: HighlightColor) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Floating anchor={anchor} className="popover marks-popover" onClose={onClose}>
      {annotations.map((a) => {
        const label = a.kind === 'highlight' ? t('toolbar.highlight') : t('toolbar.underline')
        return (
          <div className="marks-row" key={a.id}>
            <span className="marks-label">{label}</span>
            <ColorSwatches value={a.color} labelPrefix={label} onPick={(c) => onChangeColor(a.id, c)} />
            <button type="button" className="text-button danger" onClick={() => onDelete(a.id)}>
              {t('comment.delete')}
            </button>
          </div>
        )
      })}
    </Floating>
  )
}
