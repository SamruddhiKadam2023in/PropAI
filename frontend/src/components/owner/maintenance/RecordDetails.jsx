import { useState } from 'react'
import { Pencil, Phone } from 'lucide-react'
import Modal from '../../ui/Modal'
import { formatDay, formatDateTime } from '../../../utils/dates'
import { formatINR, recordMoney } from '../../../utils/money'
import { CATEGORY_LABEL, PAYMENT, PROVIDER_TYPE_LABEL, raisedBy, statusOf, urgencyOf } from './meta'
import StatusActions from './StatusActions'
import RequestProviders from './providers/RequestProviders'

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-fg-subtle">{label}</dt>
      <dd className="text-sm mt-0.5 text-fg font-semibold break-words">{children || <span className="text-fg-subtle italic font-normal">Not recorded</span>}</dd>
    </div>
  )
}

export default function RecordDetails({ record, onClose, onStatus, onEdit, onViewProviders, busy }) {
  const [showProviders, setShowProviders] = useState(false)
  const money = recordMoney(record)
  const status = statusOf(record.status)
  const urgency = urgencyOf(record.urgency)
  const s = record.service
  const pay = s ? PAYMENT[s.payment_status] : null

  return (
    <Modal wide title={record.title} subtitle={`${record.property_title || ''} · ${raisedBy(record)}`} onClose={onClose}
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusActions record={record} onStatus={onStatus} busy={busy} />
            {record.status !== 'resolved' && (
              <button type="button" className="btn-secondary !py-1 !px-2.5 !text-xs flex items-center gap-1" onClick={() => setShowProviders((v) => !v)} aria-expanded={showProviders} data-testid="contact-provider">
                <Phone size={12} aria-hidden="true" /> Contact Service Provider
              </button>
            )}
          </div>
          <button type="button" className="btn-primary !py-1.5 flex items-center gap-1.5 text-xs" onClick={() => onEdit(record)}>
            <Pencil size={13} aria-hidden="true" /> {s ? 'Edit service details' : 'Add service details'}
          </button>
        </div>
      )}>
      <div className="space-y-5" data-testid="record-details">
        {showProviders && <RequestProviders record={record} onViewAll={onViewProviders} />}
        <div className="flex flex-wrap gap-2">
          <span className={status.cls}>{status.label}</span>
          <span className={urgency.cls}>{urgency.label} priority</span>
          <span className="badge-gray">{CATEGORY_LABEL[record.category] || 'Other'}</span>
          {pay && <span className={pay.cls}>{pay.label}</span>}
        </div>

        <p className="text-sm text-fg-muted whitespace-pre-wrap break-words">{record.description || 'No description provided.'}</p>

        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Field label="Service type">{s?.service_type}</Field>
          <Field label="Service provider">{s?.provider_name}</Field>
          <Field label="Provider type">{s ? PROVIDER_TYPE_LABEL[s.provider_type] : null}</Field>
          <Field label="Raised">{formatDateTime(record.created_at)}</Field>
          <Field label="Service date">{formatDay(s?.scheduled_date)}</Field>
          <Field label="Completed">{formatDay(s?.completed_date)}</Field>
          <Field label="Invoice no.">{s?.invoice_no}</Field>
          <Field label="Payment">{pay?.label}</Field>
        </dl>

        {money ? (
          <div className="rounded-xl border border-line overflow-hidden" data-testid="breakdown">
            <table className="w-full text-sm">
              <caption className="sr-only">Fee breakdown</caption>
              <thead className="bg-surface-2">
                <tr><th scope="col" className="table-head text-left px-3">Charge</th><th scope="col" className="table-head text-right px-3">Amount</th></tr>
              </thead>
              <tbody>
                <tr className="table-row"><th scope="row" className="table-cell px-3 font-medium text-fg text-left">Service fee</th><td className="table-cell px-3 text-right tabular-nums" data-col="fee">{formatINR(money.fee)}</td></tr>
                {s.additional_charges.map((c, i) => (
                  <tr key={i} className="table-row"><th scope="row" className="table-cell px-3 text-left font-normal">+ {c.label}</th><td className="table-cell px-3 text-right tabular-nums" data-line="charge">{formatINR(c.amount)}</td></tr>
                ))}
                <tr className="table-row"><th scope="row" className="table-cell px-3 text-left font-normal text-fg-subtle">Additional charges subtotal</th><td className="table-cell px-3 text-right tabular-nums text-fg-subtle" data-col="additional">{formatINR(money.additional)}</td></tr>
              </tbody>
              <tfoot>
                <tr className="bg-surface-2"><th scope="row" className="py-3 px-3 text-left font-bold text-fg">Total amount</th><td className="py-3 px-3 text-right font-bold text-fg tabular-nums" data-col="total">{formatINR(money.total)}</td></tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="rounded-xl bg-surface-2 p-4 text-sm text-fg-muted">
            No service provider or fees have been recorded for this request yet. Use <span className="font-semibold text-fg">Add service details</span> to record who did the work and what it cost.
          </div>
        )}
      </div>
    </Modal>
  )
}
