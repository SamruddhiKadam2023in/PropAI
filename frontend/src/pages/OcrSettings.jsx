import { useEffect, useState } from 'react'
import { Loader2, Settings } from 'lucide-react'
import toast from 'react-hot-toast'
import Layout from '../components/Layout'
import { getOcrConfig, updateOcrConfig } from '../services/config'
import { errorMessage } from '../utils/http'
import { formatDateTime } from '../utils/dates'

const ENGINES = [
  { value: 'auto',     label: 'Auto (recommended)' },
  { value: 'tesseract', label: 'Tesseract' },
  { value: 'easyocr',   label: 'EasyOCR' },
]

function Notice({ id, message }) {
  return message ? <p id={id} className="p-3 rounded-xl bg-danger-soft text-danger-fg text-sm" role="alert" data-testid={id}>{message}</p> : null
}

function OcrSettingsCard() {
  const [status, setStatus] = useState('loading')     // loading | ready | error
  const [saved, setSaved] = useState(null)             // last config the server confirmed (for dirty-checking)
  const [engine, setEngine] = useState('auto')
  const [threshold, setThreshold] = useState('0.65')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setStatus('loading')
    try {
      const cfg = await getOcrConfig()
      setSaved(cfg)
      setEngine(cfg.ocr_engine || 'auto')
      setThreshold(String(cfg.confidence_threshold ?? 0.65))
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => { load() }, [])

  const dirty = saved && (engine !== (saved.ocr_engine || 'auto') || threshold !== String(saved.confidence_threshold ?? 0.65))

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    const t = Number(threshold)
    if (threshold.trim() === '' || Number.isNaN(t)) return setError('Enter a confidence threshold.')
    if (t < 0 || t > 1) return setError('The confidence threshold must be between 0.00 and 1.00.')
    setSaving(true)
    try {
      const cfg = await updateOcrConfig({ ocr_engine: engine, confidence_threshold: t })
      setSaved(cfg)
      setEngine(cfg.ocr_engine || 'auto')
      setThreshold(String(cfg.confidence_threshold ?? 0.65))
      toast.success('OCR settings saved')
    } catch (err) { setError(errorMessage(err, "We couldn't save these settings.")) }
    finally { setSaving(false) }
  }

  if (status === 'loading') {
    return <section className="card"><p className="text-fg-subtle text-sm" data-testid="ocr-settings-loading">Loading…</p></section>
  }
  if (status === 'error') {
    return (
      <section className="card">
        <p className="text-danger-fg text-sm mb-3" data-testid="ocr-settings-error">We couldn't load the OCR settings.</p>
        <button type="button" className="btn-secondary" onClick={load}>Retry</button>
      </section>
    )
  }

  return (
    <section className="card" aria-labelledby="ocr-settings-title">
      <h2 id="ocr-settings-title" className="section-title flex items-center gap-2 mb-1"><Settings size={18} aria-hidden="true" /> OCR Settings</h2>
      <p className="section-subtitle mb-4">Controls how uploaded bills are read - changes apply to the next document uploaded, no restart needed.</p>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="ocr-engine">OCR engine</label>
            <select id="ocr-engine" className="input" value={engine} onChange={(e) => setEngine(e.target.value)} data-testid="ocr-engine">
              {ENGINES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ocr-threshold">Confidence threshold <span className="text-fg-subtle font-normal">(0.00 - 1.00)</span></label>
            <input id="ocr-threshold" className="input" type="number" min="0" max="1" step="0.01" value={threshold}
                   onChange={(e) => setThreshold(e.target.value)} data-testid="ocr-threshold" />
            <p className="text-xs text-fg-subtle mt-1">Lower = trusts its own reading more often. Higher = sends more bills for manual review.</p>
          </div>
        </div>
        {saved?.updated_at && (
          <p className="text-xs text-fg-subtle" data-testid="ocr-settings-meta">
            Last changed by {saved.updated_by || 'unknown'} on {formatDateTime(saved.updated_at)}
          </p>
        )}
        <Notice id="ocr-settings-form-error" message={error} />
        <button type="submit" className="btn-primary flex items-center gap-2" disabled={saving || !dirty} data-testid="save-ocr-settings">
          {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Save settings
        </button>
      </form>
    </section>
  )
}

/** OCR pipeline settings, Owner and Manager only: which engine reads bills, and how confident it must be before trusting itself. */
export default function OcrSettings() {
  return (
    <Layout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-fg">OCR Settings</h1>
          <p className="text-fg-subtle text-sm mt-0.5">Tune how the bill-reading AI behaves</p>
        </div>
        <OcrSettingsCard />
      </div>
    </Layout>
  )
}
