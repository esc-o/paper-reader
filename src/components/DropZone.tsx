import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import './DropZone.css'

export function DropZone({ onFile }: { onFile: (file: File) => void }) {
  const { t } = useTranslation()
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      className={`dropzone${isDragging ? ' dragging' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragging(false)
        const file = e.dataTransfer.files[0]
        if (file) onFile(file)
      }}
    >
      <p className="dropzone-title">{t('drop.title')}</p>
      <p className="dropzone-hint">{t('drop.hint')}</p>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
