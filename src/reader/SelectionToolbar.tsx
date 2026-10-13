import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
          <span className="toolbar-label">{t('toolbar.highlight')}</span>
          <ColorSwatches labelPrefix={t('toolbar.highlight')} onPick={onHighlight} />
        </span>
        <span className="toolbar-divider" />
        <button type="button" className="toolbar-button" onClick={onUnderline}>
          {t('toolbar.underline')}
        </button>
        <button type="button" className="toolbar-button" onClick={onComment}>
          {t('toolbar.comment')}
        </button>
        <button type="button" className="toolbar-button" onClick={onLookup}>
          {isSingleEnglishWord(selection.text) ? t('toolbar.lookup') : t('toolbar.translate')}
        </button>
        <span className="toolbar-divider" />
        <button type="button" className="toolbar-button muted" onClick={onCancel}>
          {t('toolbar.cancel')}
        </button>
      </div>
    </Floating>
  )
}
