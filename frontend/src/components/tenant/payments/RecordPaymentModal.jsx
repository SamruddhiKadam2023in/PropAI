import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../../ui/Modal'
import { errorMessage } from '../../../utils/http'
import { recordPayment } from '../../../services/payments'
import { formatINR } from '../../../utils/money'
import { PAYMENT_TYPES } from './meta'

/** Records a payment the tenant has ALREADY made (transfer, cheque, cash...). No money is moved and no gateway is involved. */
export default function RecordPaymentModal({ properties, today, defaultPropertyId, settlement = null, onClose, onSaved }) {
  // `settlement` = a terminated / abandoned agreement being paid off: property, purpose and the ceiling come from the server's figures.
  const [form, setForm] = useState({ property_id: String(settlement?.property_id ?? defaultPropertyId ?? properties[0]?.property_id ?? ''), amount: settlement ? String(settlement.outstanding) : '', payment_type: 'rent', notes: '' })
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const validate = () => {
    const e = {}
    const amount = Number(form.amount)
    if (form.amount === '' || Number.isNaN(amount) || amount <= 0) e.amount = 'Enter the amount you paid, more than ₹0.'
    else if (amount > 10_000_000) e.amount = 'That amount is too large. Please check it.'
    else if (settlement && amount > settlement.outstanding) e.amount = `That is more than the ${formatINR(settlement.outstanding)} outstanding.`
    if (form.notes.length > 500) e.notes = 'Keep the note under 500 characters.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async (ev) => {
    ev.preventDefault()
    setServerError(null)
    if (!validate()) return
    setSaving(true)
    try {
      const saved = await recordPayment({
        property_id: Number(form.property_id), amount: Number(form.amount), payment_type: form.payment_type,
        payment_date: today, notes: form.notes.trim() || null, ...(settlement ? { agreement_id: settlement.agreement_id } : {}),    // "today" is the business date from the server, not this browser's clock
      })
      toast.success('Payment recorded')
      onSaved(saved)
    } catch (err) { setServerError(errorMessage(err, "We couldn't record this payment.")) }
    finally { setSaving(false) }
  }

  const Err = ({ id }) => (errors[id] ? <p className="text-xs text-danger-fg mt-1" role="alert">{errors[id]}</p> : null)
  return (
    <Modal title={settlement ? 'Pay outstanding balance' : 'Record a payment'} subtitle={settlement ? `${settlement.title} · agreement ${settlement.reference}` : 'Add a payment you have already made. Nothing is charged here.'} onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="record-payment" className="btn-primary flex items-center gap-2" disabled={saving} data-testid="save-payment">
            {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Record payment
          </button>
        </div>
      )}>
      <form id="record-payment" onSubmit={submit} noValidate className="space-y-4">
        {!settlement && properties.length > 1 && (
          <div>
            <label className="label" htmlFor="rp-property">Property</label>
            <select id="rp-property" className="input" value={form.property_id} onChange={set('property_id')}>
              {properties.map((p) => <option key={p.property_id} value={p.property_id}>{p.title}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="rp-amount">Amount (₹) <span className="text-danger-fg" aria-hidden="true">*</span></label>
            <input id="rp-amount" className="input" type="number" min="0" step="0.01" inputMode="decimal" value={form.amount} onChange={set('amount')} aria-invalid={!!errors.amount} placeholder="e.g. 48000" />
            <Err id="amount" />
          </div>
          <div>
            <label className="label" htmlFor="rp-type">Purpose</label>
            <select id="rp-type" className="input" value={form.payment_type} onChange={set('payment_type')} disabled={!!settlement}>
              {PAYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="rp-notes">Note <span className="text-fg-subtle font-normal">(optional)</span></label>
          <input id="rp-notes" className="input" maxLength={500} value={form.notes} onChange={set('notes')} aria-invalid={!!errors.notes} placeholder="e.g. UPI transfer — September rent" />
          <Err id="notes" />
        </div>
        <p className="text-xs text-fg-subtle" data-testid="modal-hint">{settlement ? `You can pay up to ${formatINR(settlement.outstanding)}. It is counted towards this agreement only.` : 'The payment is dated today. Rent payments are counted towards the current month.'}</p>
        {serverError && <div className="p-3 rounded-xl bg-danger-soft text-danger-fg text-sm" role="alert" data-testid="form-error">{serverError}</div>}
      </form>
    </Modal>
  )
}
