import { useTranslation } from 'react-i18next'
import { HIGHLIGHT_COLORS } from '../lib/types'
import type { HighlightColor } from '../lib/types'

type Props = {
  value?: HighlightColor
  labelPrefix: string
  onPick: (color: HighlightColor) => void
}

export function ColorSwatches({ value, labelPrefix, onPick }: Props) {
  const { t } = useTranslation()
  return (
    <span className="swatches">
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`swatch swatch-${color}${value === color ? ' selected' : ''}`}
          aria-label={`${t(`colors.${color}`)} ${labelPrefix}`}
          aria-pressed={value === undefined ? undefined : value === color}
          title={`${t(`colors.${color}`)} ${labelPrefix}`}
          onClick={() => onPick(color)}
        />
      ))}
    </span>
  )
}
