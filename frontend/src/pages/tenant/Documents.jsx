import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileText, Lock, RefreshCw, UploadCloud, X } from 'lucide-react'
import toast from 'react-hot-toast'
import DocumentCard from '../../components/documents/DocumentCard'
import DocumentViewer from '../../components/documents/DocumentViewer'
import StatusBadge from '../../components/documents/StatusBadge'
import {
  ACCEPT, FILTERS, MAX_FILES_AT_ONCE, errorMessage, formatBytes, isActive, validateFile,
} from '../../components/documents/documentUtils'
import { listDocuments, uploadDocument } from '../../services/documents'

const POLL_MS = 2500

export default function TenantDocuments() {
  const [docs, setDocs] = useState([])
  const [loadState, setLoadState] = useState('loading')
  const [uploads, setUploads] = useState([])
  const [filter, setFilter] = useState('all')
  const [dragOver, setDragOver] = useState(false)
  const [viewing, setViewing] = useState(null)
  const inputRef = useRef(null)
  const alive = useRef(true)

  useEffect(() => () => { alive.current = false }, [])

  const load = useCallback(async (initial = false) => {
    try {
      const data = await listDocuments()
      if (alive.current) { setDocs(data); setLoadState('ready') }
    } catch {
      if (alive.current && initial) setLoadState('error')
    }
  }, [])

  useEffect(() => { load(true) }, [load])

  // Keep refreshing while any document is still being read.
  const anyActive = docs.some((d) => isActive(d.status))
  useEffect(() => {
    if (!anyActive) return undefined
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [anyActive, load])

  const patchUpload = (id, patch) => setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...patch } : u)))

  const startUpload = async (file) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const problem = validateFile(file)
    if (problem) {
      setUploads((list) => [...list, { id, name: file.name, size: file.size, state: 'error', error: problem }])
      return
    }
    setUploads((list) => [...list, { id, name: file.name, size: file.size, state: 'uploading', progress: 0 }])
    try {
      const doc = await uploadDocument(file, (progress) => patchUpload(id, { progress }))
      if (!alive.current) return
      setUploads((list) => list.filter((u) => u.id !== id))
      setDocs((list) => [doc, ...list.filter((d) => d.id !== doc.id)])
      toast.success(`"${doc.filename}" uploaded. Reading it now…`)
    } catch (err) {
      if (alive.current) patchUpload(id, { state: 'error', error: errorMessage(err, 'Upload failed. Please try again.') })
    }
  }

  const handleFiles = (fileList) => {
    let files = Array.from(fileList || [])
    if (files.length > MAX_FILES_AT_ONCE) {
      toast.error(`You can upload up to ${MAX_FILES_AT_ONCE} files at a time.`)
      files = files.slice(0, MAX_FILES_AT_ONCE)
    }
    files.forEach(startUpload)
  }

  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }
  const openPicker = () => inputRef.current?.click()

  const updateDoc = (doc) => setDocs((list) => list.map((d) => (d.id === doc.id ? doc : d)))
  const removeDoc = (id) => { setDocs((list) => list.filter((d) => d.id !== id)); setViewing((v) => (v?.id === id ? null : v)) }

  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, docs.filter(f.match).length]))
  const activeFilter = FILTERS.find((f) => f.key === filter) || FILTERS[0]
  const visible = docs.filter(activeFilter.match)

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-fg">My Documents</h1>
        <p className="text-fg-subtle text-sm mt-0.5">
          Upload utility bills, rent receipts and invoices. We read them automatically and pull out the key details.
        </p>
      </div>

      <section aria-label="Upload documents" className="space-y-3">
        <div
          role="button" tabIndex={0} aria-label="Upload documents: drop files here or press Enter to browse"
          onClick={openPicker}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker() } }}
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
            dragOver ? 'border-accent bg-accent-soft scale-[1.01]' : 'border-line-strong bg-surface hover:border-accent/70 hover:bg-accent-soft/40'
          }`}
        >
          <UploadCloud size={34} className="mx-auto text-accent-text mb-2" aria-hidden="true" />
          <p className="font-semibold text-fg">Drop files here, or click to browse</p>
          <p className="text-xs text-fg-subtle mt-1">PDF, JPG, PNG or WebP · up to 10 MB each · up to {MAX_FILES_AT_ONCE} files at once</p>
        </div>
        <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" data-testid="doc-input"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }} />
        <p className="text-xs text-fg-subtle flex items-center gap-1.5">
          <Lock size={12} aria-hidden="true" /> Your documents are private. Only you, and the owner or manager of your property, can open them.
        </p>

        {uploads.map((u) => (
          <div key={u.id} className="card !p-3 flex items-center gap-3" data-testid="upload-row">
            <FileText size={18} className="text-fg-subtle flex-shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg truncate">{u.name}</p>
              {u.state === 'uploading' ? (
                <div className="progress-bar mt-1.5" role="progressbar" aria-valuenow={u.progress || 0} aria-valuemin={0} aria-valuemax={100}>
                  <div className="progress-fill bg-accent" style={{ width: `${u.progress || 0}%` }} />
                </div>
              ) : (
                <p className="text-xs text-danger-fg mt-0.5" role="alert">{u.error}</p>
              )}
            </div>
            {u.state === 'uploading'
              ? <StatusBadge status="uploading" progress={u.progress} />
              : (
                <>
                  <span className="badge-red flex-shrink-0"><AlertTriangle size={12} className="mr-1" aria-hidden="true" />Upload failed</span>
                  <button type="button" aria-label={`Dismiss ${u.name}`} className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-2"
                    onClick={() => setUploads((list) => list.filter((x) => x.id !== u.id))}>
                    <X size={16} />
                  </button>
                </>
              )}
            {u.size != null && u.state === 'uploading' && <span className="text-xs text-fg-subtle hidden sm:block">{formatBytes(u.size)}</span>}
          </div>
        ))}
      </section>

      {loadState === 'loading' && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading your documents">
          {[0, 1].map((i) => <div key={i} className="card h-24 animate-pulse" />)}
        </div>
      )}

      {loadState === 'error' && (
        <div className="card text-center py-10" role="alert">
          <AlertTriangle size={30} className="mx-auto text-danger-fg mb-2" aria-hidden="true" />
          <p className="font-semibold text-fg">We couldn't load your documents</p>
          <p className="text-sm text-fg-subtle mt-1">Check your connection and try again.</p>
          <button type="button" className="btn-primary mt-4 inline-flex items-center gap-2" onClick={() => { setLoadState('loading'); load(true) }}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      )}

      {loadState === 'ready' && docs.length === 0 && uploads.length === 0 && (
        <div className="card text-center py-12">
          <FileText size={36} className="mx-auto text-fg-subtle mb-2" aria-hidden="true" />
          <p className="font-semibold text-fg">No documents yet</p>
          <p className="text-sm text-fg-subtle mt-1">Upload your first bill or receipt above and it will appear here.</p>
        </div>
      )}

      {loadState === 'ready' && docs.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter documents">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  filter === f.key ? 'bg-accent text-accent-on' : 'bg-surface-2 text-fg-muted hover:text-fg'
                }`}>
                {f.label} <span className="opacity-80">({counts[f.key]})</span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-fg-subtle text-center py-8">No documents in this view.</p>
          ) : (
            <div className="space-y-4">
              {visible.map((doc) => (
                <DocumentCard key={doc.id} doc={doc} onView={setViewing} onUpdate={updateDoc} onRemove={removeDoc} />
              ))}
            </div>
          )}
        </>
      )}

      {viewing && <DocumentViewer doc={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
