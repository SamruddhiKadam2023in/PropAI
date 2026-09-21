import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../../ui/Modal'
import { errorMessage } from '../../../utils/http'
import { formatINR, fromCents, toCents } from '../../../utils/money'
import { saveServiceDetails } from '../../../services/ownerMaintenance'
import { PROVIDER_TYPE_LABEL, SERVICE_TYPE_SUGGESTIONS } from './meta'

const MAX_CHARGES = 10
const MAX_MONEY = 10_000_000
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
let rowKey = 0
const newRow = (label = '', amount = '') => ({ key: ++rowKey, label, amount })

export default function ServiceForm({ record, onClose, onSaved }) {
  const s = record.service
  const [form, setForm] = useState({
    provider_name: s?.provider_name ?? '',
    provider_type: s?.provider_type ?? 'independent',
    service_type: s?.service_type ?? '',
    scheduled_date: s?.scheduled_date ?? todayISO(),
    completed_date: s?.completed_date ?? '',
    service_fee: s ? String(s.service_fee) : '',
    payment_status: s?.payment_status ?? 'pending',
    invoice_no: s?.invoice_no ?? '',
  })
  const [charges, setCharges] = useState(() => (s?.additional_charges || []).map((c) => newRow(c.label, String(c.amount))))
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState(null)
  const [saving, setSaving] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const feeCents = toCents(form.service_fee)
  const additionalCents = useMemo(() => charges.reduce((sum, c) => sum + toCents(c.amount), 0), [charges])
  const total = fromCents(feeCents + additionalCents)

  const validate = () => {
    const e = {}
    if (form.provider_name.trim().length < 2) e.provider_name = 'Enter the service provider (at least 2 characters).'
    if (form.service_type.trim().length < 2) e.service_type = 'Enter the type of service (at least 2 characters).'
    if (!form.scheduled_date) e.scheduled_date = 'Choose the service date.'
    if (form.completed_date && form.completed_date < form.scheduled_date) e.completed_date = "The completion date can't be before the service date."
    const fee = Number(form.service_fee)
    if (form.service_fee === '' || Number.isNaN(fee) || fee < 0 || fee > MAX_MONEY) e.service_fee = 'Enter the service fee in rupees (0 or more).'
    charges.forEach((c) => {
      const amt = Number(c.amount)
      if ((c.label.trim() || c.amount !== '') && (!c.label.trim() || c.amount === '' || Number.isNaN(amt) || amt < 0 || amt > MAX_MONEY)) e[`charge_${c.key}`] = 'Give each extra charge a label and a valid amount.'
    })
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async (ev) => {
    ev.preventDefault()
    setServerError(null)
    if (!validate()) return
    setSaving(true)
    try {
      const saved = await saveServiceDetails(record.id, {
        provider_name: form.provider_name.trim(),
        provider_type: form.provider_type,
        service_type: form.service_type.trim(),
        scheduled_date: form.scheduled_date,
        completed_date: form.completed_date || null,
        service_fee: Number(form.service_fee),
        additional_charges: charges.filter((c) => c.label.trim() && c.amount !== '').map((c) => ({ label: c.label.trim(), amount: Number(c.amount) })),
        payment_status: form.payment_status,
        invoice_no: form.invoice_no.trim() || null,
      })
      toast.success('Service details saved')
      onSaved(saved)
    } catch (err) {
      setServerError(errorMessage(err, "We couldn't save the service details."))
    } finally { setSaving(false) }
  }

  const Err = ({ id }) => (errors[id] ? <p className="text-xs text-danger-fg mt-1" role="alert">{errors[id]}</p> : null)

  return (
    <Modal wide title={s ? 'Edit service details' : 'Add service details'} subtitle={`${record.title} · ${record.property_title || ''}`} onClose={onClose}
      footer={(
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-fg-muted">Total <span className="font-bold text-fg tabular-nums text-base" data-testid="form-total" aria-live="polite">{formatINR(total)}</span></p>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" form="service-form" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save service details'}</button>
          </div>
        </div>
      )}>
      <form id="service-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="sf-provider">Service provider <span className="text-danger-fg" aria-hidden="true">*</span></label>
            <input id="sf-provider" className="input" maxLength={120} value={form.provider_name} onChange={set('provider_name')} aria-invalid={!!errors.provider_name} placeholder="e.g. QuickFix Plumbers" />
            <Err id="provider_name" />
          </div>
          <div>
            <label className="label" htmlFor="sf-ptype">Provider type</label>
            <select id="sf-ptype" className="input" value={form.provider_type} onChange={set('provider_type')}>
              {Object.entries(PROVIDER_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="sf-stype">Service type <span className="text-danger-fg" aria-hidden="true">*</span></label>
            <input id="sf-stype" className="input" list="sf-stype-list" maxLength={80} value={form.service_type} onChange={set('service_type')} aria-invalid={!!errors.service_type} placeholder="e.g. Split AC servicing" />
            <datalist id="sf-stype-list">{SERVICE_TYPE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}</datalist>
            <Err id="service_type" />
          </div>
          <div>
            <label className="label" htmlFor="sf-invoice">Invoice no. <span className="text-fg-subtle font-normal">(optional)</span></label>
            <input id="sf-invoice" className="input" maxLength={40} value={form.invoice_no} onChange={set('invoice_no')} />
          </div>
          <div>
            <label className="label" htmlFor="sf-date">Service date <span className="text-danger-fg" aria-hidden="true">*</span></label>
            <input id="sf-date" type="date" className="input" value={form.scheduled_date} onChange={set('scheduled_date')} aria-invalid={!!errors.scheduled_date} />
            <Err id="scheduled_date" />
          </div>
          <div>
            <label className="label" htmlFor="sf-done">Completed on <span className="text-fg-subtle font-normal">(optional)</span></label>
            <input id="sf-done" type="date" className="input" value={form.completed_date} onChange={set('completed_date')} aria-invalid={!!errors.completed_date} />
            <Err id="completed_date" />
          </div>
          <div>
            <label className="label" htmlFor="sf-fee">Service fee (₹) <span className="text-danger-fg" aria-hidden="true">*</span></label>
            <input id="sf-fee" type="number" min="0" step="0.01" inputMode="decimal" className="input" value={form.service_fee} onChange={set('service_fee')} aria-invalid={!!errors.service_fee} placeholder="0.00" />
            <Err id="service_fee" />
          </div>
          <div>
            <label className="label" htmlFor="sf-pay">Payment</label>
            <select id="sf-pay" className="input" value={form.payment_status} onChange={set('payment_status')}>
              <option value="pending">Payment pending</option>
              <option value="paid">Paid</option>
            </select>
          </div>
        </div>

        <fieldset className="rounded-xl border border-line p-4 space-y-3">
          <legend className="text-sm font-semibold text-fg px-1">Additional charges <span className="text-fg-subtle font-normal">(parts, visit charge, GST…)</span></legend>
          {charges.length === 0 && <p className="text-xs text-fg-subtle">No additional charges.</p>}
          {charges.map((c, i) => (
            <div key={c.key}>
              <div className="flex items-center gap-2">
                <input className="input flex-1" aria-label={`Charge ${i + 1} label`} placeholder="e.g. Spare parts" maxLength={60} value={c.label}
                  onChange={(e) => setCharges((rows) => rows.map((r) => (r.key === c.key ? { ...r, label: e.target.value } : r)))} />
                <input className="input w-32" type="number" min="0" step="0.01" inputMode="decimal" aria-label={`Charge ${i + 1} amount`} placeholder="0.00" value={c.amount}
                  onChange={(e) => setCharges((rows) => rows.map((r) => (r.key === c.key ? { ...r, amount: e.target.value } : r)))} />
                <button type="button" className="p-2 rounded-lg text-fg-muted hover:text-danger-fg hover:bg-danger-soft" aria-label={`Remove charge ${i + 1}`}
                  onClick={() => setCharges((rows) => rows.filter((r) => r.key !== c.key))}><Trash2 size={15} /></button>
              </div>
              <Err id={`charge_${c.key}`} />
            </div>
          ))}
          <button type="button" className="btn-ghost !py-1.5 flex items-center gap-1.5 text-xs" disabled={charges.length >= MAX_CHARGES} onClick={() => setCharges((rows) => [...rows, newRow()])}>
            <Plus size={14} aria-hidden="true" /> Add a charge
          </button>
          <p className="text-xs text-fg-muted">Additional charges total <span className="font-semibold text-fg tabular-nums" data-testid="form-additional">{formatINR(fromCents(additionalCents))}</span></p>
        </fieldset>

        {serverError && <div className="p-3 rounded-xl bg-danger-soft text-danger-fg text-sm" role="alert">{serverError}</div>}
      </form>
    </Modal>
  )
}
