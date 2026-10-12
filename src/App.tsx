import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { extractParagraphs, ExtractionError } from './pdf/extractParagraphs'
import type { Paragraph } from './pdf/extractParagraphs'
import './App.css'

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; page: number; total: number }
  | { kind: 'error'; message: string }
  | { kind: 'done' }

function App() {
  const [fileName, setFileName] = useState<string | null>(null)
  const [paragraphs, setParagraphs] = useState<Paragraph[]>([])
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function openFile(file: File) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setStatus({ kind: 'error', message: '请选择 PDF 文件。' })
      return
    }
    setFileName(file.name)
    setParagraphs([])
    setStatus({ kind: 'loading', page: 0, total: 0 })
    try {
      const result = await extractParagraphs(file, (page, total) =>
        setStatus({ kind: 'loading', page, total }),
      )
      setParagraphs(result)
      setStatus({ kind: 'done' })
    } catch (error) {
      const message =
        error instanceof ExtractionError ? error.message : '读取 PDF 时出错了，请换一个文件试试。'
      console.error(error)
      setStatus({ kind: 'error', message })
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault()
    setIsDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) openFile(file)
  }

  return (
    <main className="app">
      <header>
        <h1>Paper Reader</h1>
      </header>

      <div
        className={`dropzone${isDragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <p>把 PDF 拖到这里，或者点击选择文件</p>
        {fileName && <p className="file-name">{fileName}</p>}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) openFile(file)
            e.target.value = ''
          }}
        />
      </div>

      {status.kind === 'loading' && (
        <p className="status">
          {status.total > 0 ? `正在读取第 ${status.page} / ${status.total} 页…` : '正在打开 PDF…'}
        </p>
      )}
      {status.kind === 'error' && <p className="status error">{status.message}</p>}
      {status.kind === 'done' && (
        <p className="status">共 {paragraphs.length} 段</p>
      )}

      <ol className="paragraphs">
        {paragraphs.map((p) => (
          <li key={p.id}>
            <span className="page-tag">
              {p.startPage === p.endPage ? `p.${p.startPage}` : `p.${p.startPage}–${p.endPage}`}
            </span>
            <p>{p.text}</p>
          </li>
        ))}
      </ol>
    </main>
  )
}

export default App
