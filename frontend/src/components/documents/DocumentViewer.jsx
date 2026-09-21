import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { fetchOriginal, saveOriginal } from '../../services/documents'

export default function DocumentViewer({ doc, onClose }) {
  const [state, setState] = useState({ loading: true, url: null, mime: null, error: null })
  const closeRef = useRef(null)

  useEffect(() => {
    let url = null
    let cancelled = false
    fetchOriginal(doc.id)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setState({ loading: false, url, mime: doc.mime_type || blob.type, error: null })
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, url: null, mime: null, error: "We couldn't load the original file. It may have been removed." })
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [doc.id, doc.mime_type])

  useEffect(() => {
    const opener = document.activeElement
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [onClose])

  const isPdf = state.mime === 'application/pdf'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div role="dialog" aria-modal="true" aria-label={`Original document: ${doc.filename}`}
        className="bg-surface border border-line rounded-2xl shadow-2xl w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-line">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-fg truncate">{doc.filename}</p>
            <p className="text-xs text-fg-subtle">Original file, exactly as you uploaded it</p>
          </div>
          <button type="button" className="btn-secondary !py-1.5 !px-3 flex items-center gap-1.5"
            onClick={() => saveOriginal(doc).catch(() => toast.error("Couldn't download the file."))}>
            <Download size={14} /> Download
          </button>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close viewer"
            className="p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-2">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 bg-surface-2 flex items-center justify-center overflow-auto">
          {state.loading && (
            <div className="text-fg-muted flex items-center gap-2 text-sm"><Loader2 className="animate-spin" size={18} /> Loading…</div>
          )}
          {state.error && <p className="text-danger-fg text-sm px-6 text-center">{state.error}</p>}
          {state.url && (isPdf
            ? <iframe title={doc.filename} src={state.url} className="w-full h-full border-0 bg-white" />
            : <img src={state.url} alt={doc.filename} className="max-w-full max-h-full object-contain" />)}
        </div>
      </div>
    </div>
  )
}
