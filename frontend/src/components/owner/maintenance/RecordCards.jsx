import { Calendar, Eye, MapPin, Wrench } from 'lucide-react'
import { formatDay } from '../../../utils/dates'
import { formatINR, recordMoney } from '../../../utils/money'
import { CATEGORY_LABEL, PAYMENT, PROVIDER_TYPE_LABEL, raisedBy, serviceDate, statusOf, urgencyOf } from './meta'
import StatusActions from './StatusActions'

export default function RecordCards({ records, totals, onOpen, onStatus, busyId }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="records-cards">
        {records.map((r) => {
          const money = recordMoney(r)
          const status = statusOf(r.status)
          const urgency = urgencyOf(r.urgency)
          const pay = r.service ? PAYMENT[r.service.payment_status] : null
          return (
            <article key={r.id} className={`card !p-0 overflow-hidden flex flex-col border-l-4 ${r.status === 'resolved' ? 'border-l-success' : r.urgency === 'high' ? 'border-l-danger' : 'border-l-warning'}`}
              data-testid="record-card" data-id={r.id}>
              <div className="p-4 space-y-3 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-fg break-words min-w-0">
                    {r.title}
                  </h3>
                  <span className={`${status.cls} flex-shrink-0`}>{status.label}</span>
                </div>

                <p className="text-xs text-fg-muted flex items-start gap-1.5"><MapPin size={12} className="mt-0.5 flex-shrink-0" aria-hidden="true" />{r.property_title || '—'} · {raisedBy(r)}</p>
                <p className="text-xs text-fg-muted flex items-center gap-1.5"><Calendar size={12} aria-hidden="true" />{formatDay(serviceDate(r))}{r.service?.completed_date ? ` → completed ${formatDay(r.service.completed_date)}` : ''}</p>
                <p className="text-xs text-fg-muted flex items-start gap-1.5">
                  <Wrench size={12} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  {[r.service?.service_type, CATEGORY_LABEL[r.category] || 'Other'].filter(Boolean).join(' · ')}
                </p>
                <p className="text-xs text-fg-subtle line-clamp-2 break-words">{r.description}</p>

                <div className="flex flex-wrap gap-1.5">
                  <span className={urgency.cls}>{urgency.label} priority</span>
                  {pay && <span className={pay.cls}>{pay.label}</span>}
                </div>

                {r.service ? (
                  <div className="rounded-xl bg-surface-2 p-3 text-sm space-y-1.5" data-testid="fee-box">
                    <p className="text-xs text-fg-subtle">Provider</p>
                    <p className="font-medium text-fg">{r.service.provider_name} <span className="text-xs font-normal text-fg-subtle">· {PROVIDER_TYPE_LABEL[r.service.provider_type] || ''}</span></p>
                    <dl className="pt-1.5 mt-1.5 border-t border-line space-y-1">
                      <div className="flex justify-between"><dt className="text-fg-muted">Service fee</dt><dd className="tabular-nums text-fg" data-col="fee">{formatINR(money.fee)}</dd></div>
                      {r.service.additional_charges.map((c, i) => (
                        <div key={i} className="flex justify-between text-xs"><dt className="text-fg-subtle">+ {c.label}</dt><dd className="tabular-nums text-fg-muted">{formatINR(c.amount)}</dd></div>
                      ))}
                      <div className="flex justify-between text-xs"><dt className="text-fg-muted">Additional charges</dt><dd className="tabular-nums text-fg-muted" data-col="additional">{formatINR(money.additional)}</dd></div>
                      <div className="flex justify-between pt-1.5 border-t border-line font-bold"><dt className="text-fg">Total</dt><dd className="tabular-nums text-fg" data-col="total">{formatINR(money.total)}</dd></div>
                    </dl>
                  </div>
                ) : (
                  <p className="rounded-xl bg-surface-2 p-3 text-xs text-fg-subtle italic">Service provider and fees not recorded yet.</p>
                )}
              </div>
              <div className="border-t border-line px-3 py-2 flex items-center justify-between gap-2">
                <button type="button" className="btn-ghost !py-1 !px-2 flex items-center gap-1 text-xs" onClick={() => onOpen(r)} aria-label={`View details of ${r.title}`}>
                  <Eye size={13} aria-hidden="true" /> Details
                </button>
                <StatusActions record={r} onStatus={onStatus} busy={busyId === r.id} />
              </div>
            </article>
          )
        })}
      </div>

      <div className="card !p-4 flex flex-wrap items-center justify-between gap-3" data-testid="totals-row">
        <p className="text-sm font-semibold text-fg">Totals for {totals.count} filtered record{totals.count === 1 ? '' : 's'}
          <span className="block text-xs font-normal text-fg-subtle">{totals.withService} with service fees recorded</span></p>
        <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <div><dt className="text-xs text-fg-subtle">Service fees</dt><dd className="font-bold text-fg tabular-nums" data-col="fee">{formatINR(totals.fee)}</dd></div>
          <div><dt className="text-xs text-fg-subtle">Additional charges</dt><dd className="font-bold text-fg tabular-nums" data-col="additional">{formatINR(totals.additional)}</dd></div>
          <div><dt className="text-xs text-fg-subtle">Total</dt><dd className="font-bold text-fg tabular-nums" data-col="total">{formatINR(totals.total)}</dd></div>
        </dl>
      </div>
    </div>
  )
}
