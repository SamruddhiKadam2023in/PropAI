import { useState } from 'react'
import {
  AlertTriangle, ChevronDown, Download, Eye, FileImage, FileText, Pencil, RefreshCw, Save, Trash2, X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import StatusBadge from './StatusBadge'
import { DOC_TYPES, confidenceInfo, errorMessage, formatBytes, formatDateTime, formatMoney, isActive } from './documentUtils'
import { correctDocument, deleteDocument, reprocessDocument, saveOriginal } from '../../services/documents'

function Field({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-fg-subtle">{label}</dt>
      <dd className={`text-sm mt-0.5 break-words ${value ? 'text-fg font-semibold' : 'text-fg-subtle italic'}`}>
        {value || 'Not found'}
      </dd>
    </div>
  )
}

export default function DocumentCard({ doc, onView, onUpdate, onRemove }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [form, setForm] = useState({ amount: '', date: '', vendor: '', document_type: 'other' })

  const data = doc.extracted_data || {}
  const active = isActive(doc.status)
  const readable = doc.status === 'completed' || doc.status === 'flagged'
  const conf = confidenceInfo(doc.confidence_score)
  const Icon = doc.mime_type === 'application/pdf' ? FileText : FileImage
  const typeLabel = DOC_TYPES[doc.document_type] || null
  const edited = doc.corrected_data && Object.keys(doc.corrected_data).length > 0

  const startEdit = () => {
    setForm({
      amount: data.amount ?? '',
      date: data.date ?? '',
      vendor: data.vendor ?? '',
      document_type: doc.document_type || 'other',
    })
    setOpen(true)
    setEditing(true)
  }

  const save = async (e) => {
    e.preventDefault()
    const payload = { document_type: form.document_type }
    if (form.amount !== '') {
      const amount = Number(form.amount)
      if (Number.isNaN(amount) || amount < 0) return toast.error('Enter a valid amount.')
      payload.amount = amount
    }
    if (form.date.trim()) payload.date = form.date.trim()
    if (form.vendor.trim()) payload.vendor = form.vendor.trim()
    setBusy('save')
    try {
      onUpdate(await correctDocument(doc.id, payload))
      toast.success('Details saved')
      setEditing(false)
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save your changes."))
    } finally { setBusy(null) }
  }

  const retry = async () => {
    setBusy('retry')
    try {
      onUpdate(await reprocessDocument(doc.id))
      toast.success('Reading your document again…')
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't restart processing."))
    } finally { setBusy(null) }
  }

  const remove = async () => {
    setBusy('delete')
    try {
      await deleteDocument(doc.id)
      onRemove(doc.id)
      toast.success('Document deleted')
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't delete the document."))
      setBusy(null)
    }
  }

  const download = () => saveOriginal(doc).catch(() => toast.error("Couldn't download the file."))

  return (
    <article className="card !p-0 overflow-hidden" aria-busy={active}>
      <div className="p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent-soft text-accent-text flex items-center justify-center flex-shrink-0">
          <Icon size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-fg truncate" title={doc.filename}>{doc.filename}</h3>
          <p className="text-xs text-fg-subtle mt-0.5">
            {[typeLabel, formatBytes(doc.file_size), `Uploaded ${formatDateTime(doc.uploaded_at)}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <StatusBadge status={doc.status} />
      </div>

      {active && (
        <div className="px-4 pb-4">
          <div className="progress-bar"><div className="progress-fill bg-accent w-2/3 animate-pulse" /></div>
          <p className="text-xs text-fg-subtle mt-2">Reading your document — this usually takes a few seconds.</p>
        </div>
      )}

      {doc.status === 'failed' && (
        <div className="mx-4 mb-4 p-3 rounded-xl bg-danger-soft text-danger-fg text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-semibold">We couldn't read this document</p>
            <p className="mt-0.5">{doc.error_message || 'Something went wrong while reading it.'}</p>
            <p className="mt-1 opacity-90">Your original file is safe. You can try again, or upload a clearer copy.</p>
          </div>
        </div>
      )}

      {readable && (
        <div className="px-4 pb-4">
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-xl bg-surface-2">
            <Field label="Amount" value={formatMoney(data.amount)} />
            <Field label="Date" value={data.date} />
            <Field label="Vendor" value={data.vendor} />
            <Field label="Type" value={typeLabel} />
          </dl>
          {(data.address?.place || data.due_date || data.bill_period) && (
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 mt-2 rounded-xl bg-surface-2" data-testid="doc-extra">
              {data.due_date && <Field label="Due date" value={data.due_date} />}
              {data.bill_period && <Field label="Billing period" value={data.bill_period} />}
              {data.customer_name && <Field label="Name on bill" value={data.customer_name} />}
              {data.address?.place && (
                <div className="col-span-2 sm:col-span-4 min-w-0" data-testid="doc-address">
                  <dt className="text-xs font-medium text-fg-subtle">Address</dt>
                  <dd className="text-sm mt-0.5 break-words text-fg font-semibold">{data.address.place}</dd>
                  {[data.address.suburb, data.address.city, data.address.state, data.address.pincode].some(Boolean) && (
                    <dd className="mt-1.5 flex flex-wrap gap-1.5">
                      {[['Suburb', data.address.suburb], ['City', data.address.city], ['State', data.address.state], ['PIN', data.address.pincode]]
                        .filter(([, v]) => v).map(([k, v]) => <span key={k} className="badge-gray" title={k}>{v}</span>)}
                    </dd>
                  )}
                </div>
              )}
            </dl>
          )}
          {data.is_duplicate && (
            <p className="mt-2 text-xs text-fg-muted" data-testid="doc-duplicate">This looks like a duplicate copy of a bill, not the original.</p>
          )}
          {doc.status === 'flagged' && (
            <div className="mt-3 p-3 rounded-xl bg-warning-soft text-warning-fg text-sm flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <p className="flex-1">
                {data.low_resolution
                  ? `This picture is too small to read reliably (${data.image_width}px wide). Upload a sharper photo or scan (at least 1000px wide), or fill the details in yourself.`
                  : 'Some details may be wrong or missing. Please check them against the original.'}{' '}
                <button type="button" onClick={startEdit} className="font-semibold underline">Review &amp; correct</button>
              </p>
            </div>
          )}
        </div>
      )}

      {open && readable && (
        <div className="border-t border-line px-4 py-4 space-y-4 bg-surface">
          {editing ? (
            <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor={`amt-${doc.id}`}>Amount (₹)</label>
                <input id={`amt-${doc.id}`} className="input" type="number" min="0" step="0.01" value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor={`date-${doc.id}`}>Date</label>
                <input id={`date-${doc.id}`} className="input" value={form.date} placeholder="e.g. 05/12/2025"
                  onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor={`vendor-${doc.id}`}>Vendor</label>
                <input id={`vendor-${doc.id}`} className="input" value={form.vendor}
                  onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor={`type-${doc.id}`}>Document type</label>
                <select id={`type-${doc.id}`} className="input" value={form.document_type}
                  onChange={(e) => setForm({ ...form, document_type: e.target.value })}>
                  {Object.entries(DOC_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <button type="submit" className="btn-primary flex items-center gap-1.5" disabled={busy === 'save'}>
                  <Save size={14} /> {busy === 'save' ? 'Saving…' : 'Save changes'}
                </button>
                <button type="button" className="btn-secondary flex items-center gap-1.5" onClick={() => setEditing(false)}>
                  <X size={14} /> Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Field label="Uploaded" value={formatDateTime(doc.uploaded_at)} />
                <Field label="Processed" value={formatDateTime(doc.processed_at)} />
                <Field label="File size" value={formatBytes(doc.file_size)} />
              </dl>
              {conf && (
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-fg-subtle">Reading confidence</span>
                    <span className={`font-semibold ${conf.text}`}>{conf.pct}% · {conf.label}</span>
                  </div>
                  <div className="progress-bar" role="progressbar" aria-valuenow={conf.pct} aria-valuemin={0} aria-valuemax={100}
                    aria-label="Reading confidence">
                    <div className={`progress-fill ${conf.bar}`} style={{ width: `${conf.pct}%` }} />
                  </div>
                </div>
              )}
              {edited && <p className="text-xs text-fg-subtle">Some details were corrected by you.</p>}
              {doc.raw_ocr_text && (
                <details className="group">
                  <summary className="cursor-pointer text-sm font-medium text-accent-text">Text read from the document</summary>
                  <pre className="mt-2 p-3 rounded-xl bg-surface-2 text-xs text-fg-muted whitespace-pre-wrap break-words max-h-48 overflow-auto">
                    {doc.raw_ocr_text}
                  </pre>
                </details>
              )}
              <button type="button" className="btn-secondary !py-1.5 flex items-center gap-1.5" onClick={startEdit}>
                <Pencil size={14} /> Edit details
              </button>
            </>
          )}
        </div>
      )}

      <div className="border-t border-line px-3 py-2 flex flex-wrap items-center gap-1">
        <button type="button" className="btn-ghost flex items-center gap-1.5" onClick={() => onView(doc)} disabled={!doc.file_available}>
          <Eye size={14} /> View original
        </button>
        <button type="button" className="btn-ghost flex items-center gap-1.5" onClick={download} disabled={!doc.file_available}>
          <Download size={14} /> Download
        </button>
        {readable && (
          <button type="button" className="btn-ghost flex items-center gap-1.5" aria-expanded={open}
            onClick={() => { setOpen(!open); if (open) setEditing(false) }}>
            <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} /> {open ? 'Hide details' : 'Details'}
          </button>
        )}
        {(doc.status === 'failed' || doc.status === 'flagged') && (
          <button type="button" className="btn-ghost flex items-center gap-1.5" onClick={retry} disabled={busy === 'retry' || !doc.file_available}>
            <RefreshCw size={14} className={busy === 'retry' ? 'animate-spin' : ''} /> {doc.status === 'failed' ? 'Try again' : 'Re-scan'}
          </button>
        )}
        <span className="flex-1" />
        {confirmDelete ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="text-fg-muted">Delete this document and its original file?</span>
            <button type="button" className="btn-danger !py-1 !px-3" onClick={remove} disabled={busy === 'delete'}>
              {busy === 'delete' ? 'Deleting…' : 'Delete'}
            </button>
            <button type="button" className="btn-secondary !py-1 !px-3" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="btn-ghost flex items-center gap-1.5 hover:!text-danger-fg" onClick={() => setConfirmDelete(true)}
            aria-label={`Delete ${doc.filename}`}>
            <Trash2 size={14} /> Delete
          </button>
        )}
      </div>
    </article>
  )
}
