import { Eye } from 'lucide-react'
import { formatDay } from '../../../utils/dates'
import { formatINR, recordMoney } from '../../../utils/money'
import { CATEGORY_LABEL, PROVIDER_TYPE_LABEL, raisedBy, serviceDate, statusOf, urgencyOf } from './meta'
import StatusActions from './StatusActions'

const th = 'table-head text-left whitespace-nowrap'
const thNum = 'table-head text-right whitespace-nowrap'

export default function RecordsTable({ records, totals, onOpen, onStatus, busyId }) {
  return (
    <div className="card !p-0 overflow-hidden">
      <div className="overflow-x-auto relative">
        <table className="w-full text-sm min-w-[1040px]" data-testid="records-table">
          <caption className="sr-only">Maintenance requests and service records with fees</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={th}>Date</th>
              <th scope="col" className={th}>Property</th>
              <th scope="col" className={th}>Service</th>
              <th scope="col" className={th}>Provider</th>
              <th scope="col" className={th}>Status</th>
              <th scope="col" className={thNum}>Service fee</th>
              <th scope="col" className={thNum}>Additional</th>
              <th scope="col" className={thNum}>Total</th>
              <th scope="col" className={thNum}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const money = recordMoney(r)
              const status = statusOf(r.status)
              const urgency = urgencyOf(r.urgency)
              return (
                <tr key={r.id} className="table-row align-top" data-testid="record-row" data-id={r.id}>
                  <td className="table-cell whitespace-nowrap">
                    <p className="font-medium text-fg">{formatDay(serviceDate(r))}</p>
                    <p className="text-xs text-fg-subtle">Raised {formatDay(r.created_at)}</p>
                  </td>
                  <td className="table-cell min-w-[9rem]">
                    <p className="font-medium text-fg">{r.property_title || '—'}</p>
                    <p className="text-xs text-fg-subtle">{raisedBy(r)}</p>
                  </td>
                  <td className="table-cell min-w-[15rem]">
                    <p className="font-semibold text-fg break-words">
                      {r.title}
                    </p>
                    <p className="text-xs text-fg-muted mt-0.5">{[r.service?.service_type, CATEGORY_LABEL[r.category] || 'Other'].filter(Boolean).join(' · ')}</p>
                    <p className="text-xs text-fg-subtle mt-0.5 line-clamp-2 break-words">{r.description}</p>
                  </td>
                  <td className="table-cell min-w-[10rem]">
                    {r.service
                      ? (<><p className="font-medium text-fg">{r.service.provider_name}</p><p className="text-xs text-fg-subtle">{PROVIDER_TYPE_LABEL[r.service.provider_type] || ''}</p></>)
                      : <span className="text-fg-subtle italic text-xs">Not recorded</span>}
                  </td>
                  <td className="table-cell whitespace-nowrap">
                    <div className="flex flex-col items-start gap-1">
                      <span className={status.cls}>{status.label}</span>
                      <span className={`${urgency.cls} !text-[10px]`}>{urgency.label} priority</span>
                    </div>
                  </td>
                  <td className="table-cell text-right tabular-nums whitespace-nowrap" data-col="fee">{money ? formatINR(money.fee) : '—'}</td>
                  <td className="table-cell text-right tabular-nums whitespace-nowrap" data-col="additional">{money ? formatINR(money.additional) : '—'}</td>
                  <td className="table-cell text-right tabular-nums whitespace-nowrap font-bold text-fg" data-col="total">{money ? formatINR(money.total) : '—'}</td>
                  <td className="table-cell text-right whitespace-nowrap">
                    <div className="flex flex-col items-end gap-1.5">
                      <button type="button" className="btn-ghost !py-1 !px-2 flex items-center gap-1 text-xs" onClick={() => onOpen(r)} aria-label={`View details of ${r.title}`}>
                        <Eye size={13} aria-hidden="true" /> Details
                      </button>
                      <StatusActions record={r} onStatus={onStatus} busy={busyId === r.id} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-surface-2/60" data-testid="totals-row">
              <th scope="row" colSpan={5} className="py-3 px-2 text-left text-sm font-semibold text-fg">
                Totals for {totals.count} filtered record{totals.count === 1 ? '' : 's'}
                <span className="block text-xs font-normal text-fg-subtle">{totals.withService} with service fees recorded</span>
              </th>
              <td className="py-3 px-2 text-right font-bold text-fg tabular-nums" data-col="fee">{formatINR(totals.fee)}</td>
              <td className="py-3 px-2 text-right font-bold text-fg tabular-nums" data-col="additional">{formatINR(totals.additional)}</td>
              <td className="py-3 px-2 text-right font-bold text-fg tabular-nums" data-col="total">{formatINR(totals.total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
