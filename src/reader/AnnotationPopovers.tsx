import { useEffect, useRef, useState } from 'react'
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
        placeholder="写下你的想法…（Ctrl + Enter 保存）"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && trimmed) onSave(trimmed)
        }}
      />
      <div className="popover-actions">
        <button type="button" className="text-button" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="solid-button" disabled={!trimmed} onClick={() => onSave(trimmed)}>
          保存
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
  return (
    <Floating anchor={anchor} className="popover comment-popover" onClose={onClose}>
      <p className="popover-title">写评论</p>
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
  const [editing, setEditing] = useState(false)

  return (
    <Floating anchor={anchor} className="popover comment-popover" onClose={onClose}>
      <p className="popover-title">评论</p>
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
                if (window.confirm('删除这条评论？')) onDelete()
              }}
            >
              删除
            </button>
            <button type="button" className="solid-button" onClick={() => setEditing(true)}>
              编辑
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
  return (
    <Floating anchor={anchor} className="popover marks-popover" onClose={onClose}>
      {annotations.map((a) => {
        const label = a.kind === 'highlight' ? '高亮' : '划线'
        return (
          <div className="marks-row" key={a.id}>
            <span className="marks-label">{label}</span>
            <ColorSwatches value={a.color} labelPrefix={label} onPick={(c) => onChangeColor(a.id, c)} />
            <button type="button" className="text-button danger" onClick={() => onDelete(a.id)}>
              删除
            </button>
          </div>
        )
      })}
    </Floating>
  )
}
