import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Anchor } from './selection'

type Props = {
  anchor: Anchor
  placement?: 'above' | 'below'
  className?: string
  /** Stops clicks inside from clearing the user's text selection. */
  keepSelection?: boolean
  /** Called on Escape or a pointer press outside. */
  onClose?: () => void
  children: ReactNode
}

const GAP = 10
const MARGIN = 8

/** A box positioned next to `anchor`, kept inside the viewport horizontally. */
export function Floating({ anchor, placement = 'below', className, keepSelection, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: anchor.bottom + GAP, left: anchor.left })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const place = () => {
      const { width, height } = el.getBoundingClientRect()
      const viewLeft = window.scrollX
      const viewWidth = document.documentElement.clientWidth
      const center = (anchor.left + anchor.right) / 2
      const left = Math.max(
        viewLeft + MARGIN,
        Math.min(center - width / 2, viewLeft + viewWidth - width - MARGIN),
      )
      const above = anchor.top - height - GAP
      const top = placement === 'above' && above >= window.scrollY + MARGIN ? above : anchor.bottom + GAP
      setPosition((prev) => (prev.top === top && prev.left === left ? prev : { top, left }))
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(el)
    return () => observer.disconnect()
  }, [anchor, placement])

  useEffect(() => {
    if (!onClose) return
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
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

  return createPortal(
    <div
      ref={ref}
      className={`floating ${className ?? ''}`}
      style={position}
      onMouseDown={keepSelection ? (e) => e.preventDefault() : undefined}
    >
      {children}
    </div>,
    document.body,
  )
}
