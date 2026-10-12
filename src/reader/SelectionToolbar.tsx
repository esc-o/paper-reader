import { isSingleEnglishWord } from '../lib/lookup'
import type { HighlightColor } from '../lib/types'
import { ColorSwatches } from './ColorSwatches'
import { Floating } from './Floating'
import type { PendingSelection } from './selection'

type Props = {
  selection: PendingSelection
  onHighlight: (color: HighlightColor) => void
  onUnderline: () => void
  onComment: () => void
  onLookup: () => void
  onCancel: () => void
}

export function SelectionToolbar({ selection, onHighlight, onUnderline, onComment, onLookup, onCancel }: Props) {
  // On touch screens the system's own copy/paste menu sits above the selection.
  const isTouch = window.matchMedia('(pointer: coarse)').matches

  return (
    <Floating
      anchor={selection.anchor}
      placement={isTouch ? 'below' : 'above'}
      className="selection-toolbar"
      keepSelection
    >
      <div data-keep-panel>
        <span className="toolbar-group">
          <span className="toolbar-label">高亮</span>
          <ColorSwatches labelPrefix="高亮" onPick={onHighlight} />
        </span>
        <span className="toolbar-divider" />
        <button type="button" className="toolbar-button" onClick={onUnderline}>
          划线
        </button>
        <button type="button" className="toolbar-button" onClick={onComment}>
          评论
        </button>
        <button type="button" className="toolbar-button" onClick={onLookup}>
          {isSingleEnglishWord(selection.text) ? '查词' : '翻译'}
        </button>
        <span className="toolbar-divider" />
        <button type="button" className="toolbar-button muted" onClick={onCancel}>
          取消
        </button>
      </div>
    </Floating>
  )
}
