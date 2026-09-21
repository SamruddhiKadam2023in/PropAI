import { useState, useRef, useEffect, useCallback } from 'react'
import { Upload, FileText, X, RefreshCw, Cpu } from 'lucide-react'
import api from '../services/api'
import toast from 'react-hot-toast'

export default function DocumentUpload({ propertyId, onUploadComplete }) {
  const [uploading, setUploading] = useState(false)
  const [docs, setDocs]           = useState([])
  const [dragOver, setDragOver]   = useState(false)
  const inputRef = useRef()

  const fetchDocs = useCallback(async () => {
    try {
      const { data } = await api.get('/documents/')
      setDocs(data)
    } catch {}
  }, [])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  const handleUpload = async (file) => {
    if (!file) return
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowed.includes(file.type)) { toast.error('Only JPEG, PNG, WebP, PDF allowed'); return }
    if (file.size > 10 * 1024 * 1024) { toast.error('File too large (max 10 MB)'); return }

    const formData = new FormData()
    formData.append('file', file)
    if (propertyId) formData.append('property_id', propertyId)

    setUploading(true)
    try {
      const { data } = await api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setDocs(prev => [data, ...prev])
      toast.success('Document saved successfully')
      onUploadComplete?.()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleDelete = async (docId) => {
    try {
      await api.delete(`/documents/${docId}`)
      setDocs(prev => prev.filter(d => d.id !== docId))
      toast.success('Document deleted')
    } catch { toast.error('Delete failed') }
  }

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false)
    handleUpload(e.dataTransfer.files[0])
  }

  return (
    <div className="space-y-5">
      {/* Upload zone */}
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
          dragOver    ? 'border-accent/70 bg-accent-soft scale-[1.01]'
          : uploading ? 'border-accent/50 bg-accent-soft/50 cursor-wait'
          : 'border-line-strong hover:border-accent/70 hover:bg-accent-soft/40'
        }`}
      >
        {uploading ? (
          <>
            <Cpu size={36} className="mx-auto text-accent-text mb-3 animate-pulse" />
            <p className="font-semibold text-accent-text">Saving document…</p>
          </>
        ) : (
          <>
            <Upload size={36} className="mx-auto text-accent-text mb-3" />
            <p className="font-semibold text-fg">Drop a file here, or click to browse</p>
            <p className="text-xs text-fg-subtle mt-1">JPEG · PNG · WebP · PDF &nbsp;·&nbsp; max 10 MB</p>
          </>
        )}
      </div>
      <input ref={inputRef} type="file" className="hidden"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={e => handleUpload(e.target.files?.[0])} />

      {/* Documents list */}
      {docs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-fg">Uploaded Documents ({docs.length})</p>
            <button onClick={fetchDocs} className="text-xs text-accent-text hover:text-accent flex items-center gap-1">
              <RefreshCw size={11} /> Refresh
            </button>
          </div>
          {docs.map(doc => (
            <div key={doc.id} className="flex items-center gap-3 p-4 rounded-2xl border border-line bg-surface">
              <div className="w-9 h-9 rounded-xl bg-accent-soft flex items-center justify-center flex-shrink-0">
                <FileText size={16} className="text-accent-text" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-fg truncate">{doc.filename}</p>
                <p className="text-xs text-fg-subtle">
                  {doc.uploaded_at
                    ? new Date(doc.uploaded_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                    : ''}
                </p>
              </div>
              <button onClick={() => handleDelete(doc.id)} className="p-1 text-fg-subtle hover:text-danger-fg transition-colors flex-shrink-0">
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
