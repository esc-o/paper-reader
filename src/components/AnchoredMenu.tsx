import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

export function AnchoredMenu({
  id,
  open,
  label,
  onToggle,
  onClose,
  children,
}: {
  id: string
  open: boolean
  label: string
  onToggle: () => void
  onClose: () => void
  children: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({})

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open, onClose])

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const button = buttonRef.current
      const menu = menuRef.current
      if (!button || !menu) return
      const rect = button.getBoundingClientRect()
      const gap = 4
      const margin = 8
      const width = menu.offsetWidth
      const height = menu.offsetHeight
      const spaceBelow = window.innerHeight - rect.bottom - margin
      const spaceAbove = rect.top - margin
      const openUp = spaceBelow < height + gap && spaceAbove > spaceBelow
      let top = openUp ? rect.top - gap - height : rect.bottom + gap
      const maxTop = Math.max(margin, window.innerHeight - height - margin)
      top = Math.min(Math.max(top, margin), maxTop)
      let left = rect.right - width
      left = Math.min(Math.max(left, margin), Math.max(margin, window.innerWidth - width - margin))
      setStyle({ top, left })
    }
    place()
    const menu = menuRef.current
    const observer = new ResizeObserver(place)
    if (menu) observer.observe(menu)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  return (
    <div className="book-more" id={id} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="book-delete"
        aria-expanded={open}
        onClick={onToggle}
      >
        {label}
      </button>
      {open && (
        <div className="book-menu" ref={menuRef} style={style}>
          {children}
        </div>
      )}
    </div>
  )
}
