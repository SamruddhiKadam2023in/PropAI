import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Loader2, Receipt, SearchX } from 'lucide-react'
import { EmptyState } from '../../ui/States'
import { formatDay } from '../../../utils/dates'
import { formatINR } from '../../../utils/money'
import { PAYMENT_TYPES, monthLabel, txnStatus } from './meta'

const PAGE_SIZE = 10

function Purpose({ t }) {
  return (
    <div className="min-w-0">
      <span className="badge-indigo" data-testid="txn-type">{t.payment_type_label}</span>
      {t.payment_type === 'rent' && t.month && <span className="text-xs text-fg-muted ml-2">for {monthLabel(t.month)}</span>}
      {t.notes && <p className="text-xs text-fg-subtle mt-1 break-words" data-testid="txn-notes">{t.notes}</p>}
    </div>
  )
}

function Reference({ t }) {
  return (
    <div className="min-w-0">
      <p className="font-medium text-fg break-words" data-testid="txn-property">{t.property_title || '—'}</p>
      {t.agreement_ref && <p className="text-xs text-fg-subtle" data-testid="txn-agreement">Agreement {t.agreement_ref}</p>}
    </div>
  )
}

function ReceiptButton({ t, busyId, onReceipt }) {
  if (!t.receipt_available) return <span className="text-xs text-fg-subtle" data-testid="no-receipt">—</span>
  const busy = busyId === t.id
  return (
    <button type="button" className="btn-ghost !py-1 !px-2 inline-flex items-center gap-1 text-xs" onClick={() => onReceipt(t)} disabled={busy}
      aria-label={`Download receipt for ${t.transaction_id}`} data-testid="download-receipt">
      {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Download size={13} aria-hidden="true" />} Receipt
    </button>
  )
}

/** Transaction history: filterable, paginated; a table on wide screens and cards on phones. */
export default function TransactionList({ items, busyId, onReceipt }) {
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')
  const [page, setPage] = useState(1)

  const shown = useMemo(() => items.filter((t) => (status === 'all' || t.status === status) && (type === 'all' || t.payment_type === type)), [items, status, type])
  useEffect(() => { setPage(1) }, [status, type])
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const rows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const usedTypes = useMemo(() => new Set(items.map((t) => t.payment_type)), [items])

  if (items.length === 0) {
    return <EmptyState icon={Receipt} title="No transactions yet" description="Payments you record will appear here with their transaction ID, date, purpose and status." />
  }

  return (
    <div data-testid="transactions">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <p className="text-sm text-fg-muted" data-testid="txn-count">{shown.length} of {items.length} transaction{items.length === 1 ? '' : 's'}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="tx-status">Status</label>
            <select id="tx-status" className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="filter-status">
              <option value="all">All statuses</option><option value="completed">Completed</option><option value="pending">Pending</option><option value="failed">Failed</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="tx-type">Purpose</label>
            <select id="tx-type" className="input !w-auto" value={type} onChange={(e) => setType(e.target.value)} data-testid="filter-type">
              <option value="all">All purposes</option>
              {PAYMENT_TYPES.filter((p) => usedTypes.has(p.value)).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={SearchX} title="No transactions match" description="Try a different status or purpose."
          action={<button type="button" className="btn-secondary" onClick={() => { setStatus('all'); setType('all') }}>Clear filters</button>} />
      ) : (
        <>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Payment transactions, newest first</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="table-head text-left">Transaction ID</th>
                  <th scope="col" className="table-head text-left">Date</th>
                  <th scope="col" className="table-head text-left">Purpose</th>
                  <th scope="col" className="table-head text-left">Property</th>
                  <th scope="col" className="table-head text-right">Amount</th>
                  <th scope="col" className="table-head text-left">Status</th>
                  <th scope="col" className="table-head text-right">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const st = txnStatus(t.status)
                  return (
                    <tr key={t.id} className="table-row align-top" data-testid="txn-row" data-id={t.id} data-status={t.status}>
                      <td className="table-cell font-mono text-xs whitespace-nowrap text-fg" data-testid="txn-id">{t.transaction_id}</td>
                      <td className="table-cell whitespace-nowrap text-fg-muted" data-testid="txn-date">{formatDay(t.payment_day)}</td>
                      <td className="table-cell"><Purpose t={t} /></td>
                      <td className="table-cell"><Reference t={t} /></td>
                      <td className="table-cell text-right font-bold text-fg tabular-nums whitespace-nowrap" data-testid="txn-amount">{formatINR(t.amount)}</td>
                      <td className="table-cell"><span className={st.cls} data-testid="txn-status">{st.label}</span></td>
                      <td className="table-cell text-right"><ReceiptButton t={t} busyId={busyId} onReceipt={onReceipt} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <ul className="md:hidden space-y-3">
            {rows.map((t) => {
              const st = txnStatus(t.status)
              return (
                <li key={t.id} className="rounded-xl border border-line p-3 space-y-2" data-testid="txn-card" data-id={t.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="font-mono text-xs text-fg" data-testid="txn-id">{t.transaction_id}</p><p className="text-xs text-fg-muted" data-testid="txn-date">{formatDay(t.payment_day)}</p></div>
                    <div className="text-right"><p className="font-bold text-fg tabular-nums" data-testid="txn-amount">{formatINR(t.amount)}</p><span className={st.cls} data-testid="txn-status">{st.label}</span></div>
                  </div>
                  <Purpose t={t} />
                  <Reference t={t} />
                  <div className="flex justify-end"><ReceiptButton t={t} busyId={busyId} onReceipt={onReceipt} /></div>
                </li>
              )
            })}
          </ul>

          {pages > 1 && (
            <nav className="flex items-center justify-between gap-3 mt-4" aria-label="Transaction pages" data-testid="pager">
              <p className="text-sm text-fg-muted">Page {current} of {pages}</p>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary !py-1.5 flex items-center gap-1" onClick={() => setPage(current - 1)} disabled={current === 1}><ChevronLeft size={14} aria-hidden="true" /> Previous</button>
                <button type="button" className="btn-secondary !py-1.5 flex items-center gap-1" onClick={() => setPage(current + 1)} disabled={current === pages}>Next <ChevronRight size={14} aria-hidden="true" /></button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
