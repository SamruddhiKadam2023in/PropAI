import { CalendarClock, Home, Receipt } from 'lucide-react'
import { formatDay } from '../../../utils/dates'
import { formatINR } from '../../../utils/money'
import { PERIOD_STATUS, monthLong, typeLabel } from './meta'

/** What is owed for the current month on one rented property, and the last completed payment. */
export default function CurrentPayment({ card }) {
  const c = card.current
  const st = PERIOD_STATUS[c.status] || PERIOD_STATUS.unpaid
  const pct = c.rent_due > 0 ? Math.min(100, Math.round((c.paid / c.rent_due) * 100)) : 100
  const last = card.last_payment

  return (
    <section className="card" data-testid="current-payment" data-property-id={card.property_id} aria-label={`Current payment for ${card.title}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-fg-subtle uppercase tracking-wide">Rent due for {monthLong(c.month)}</p>
          <p className="text-3xl font-bold text-fg mt-1 tabular-nums" data-testid="rent-due">{formatINR(c.rent_due)}</p>
        </div>
        <span className={st.cls} data-testid="period-status">{st.label}</span>
      </div>

      <div className="mt-4" role="img" aria-label={`${pct}% of this month's rent paid`}>
        <div className="h-2 rounded-full bg-surface-3 overflow-hidden"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
      </div>
      <dl className="grid grid-cols-3 gap-3 mt-3 text-sm">
        <div><dt className="text-xs text-fg-subtle">Paid</dt><dd className="font-semibold text-fg tabular-nums" data-testid="paid-amount">{formatINR(c.paid)}</dd></div>
        <div><dt className="text-xs text-fg-subtle">Outstanding</dt><dd className={`font-semibold tabular-nums ${c.balance > 0 ? 'text-warning-fg' : 'text-success-fg'}`} data-testid="balance-amount">{formatINR(c.balance)}</dd></div>
        <div><dt className="text-xs text-fg-subtle">Awaiting confirmation</dt><dd className="font-semibold text-fg tabular-nums" data-testid="pending-amount">{formatINR(c.pending)}</dd></div>
      </dl>

      <div className="mt-4 pt-4 border-t border-line grid gap-2 sm:grid-cols-2 text-sm">
        <p className="flex items-start gap-2 text-fg-muted min-w-0"><Home size={15} className="mt-0.5 flex-shrink-0 text-fg-subtle" aria-hidden="true" /><span className="min-w-0"><span className="font-semibold text-fg" data-testid="property-title">{card.title}</span><br /><span className="text-xs break-words">{card.address}</span></span></p>
        <p className="flex items-start gap-2 text-fg-muted"><CalendarClock size={15} className="mt-0.5 flex-shrink-0 text-fg-subtle" aria-hidden="true" />
          <span data-testid="last-payment">{last
            ? <>Last payment: <span className="font-semibold text-fg">{formatINR(last.amount)}</span> on {formatDay(last.payment_day)} <span className="text-xs text-fg-subtle">({typeLabel(last.payment_type)} · {last.transaction_id})</span></>
            : 'No completed payment yet.'}</span></p>
        {card.agreement_ref && <p className="flex items-center gap-2 text-fg-muted"><Receipt size={15} className="text-fg-subtle" aria-hidden="true" /> Agreement <span className="font-semibold text-fg" data-testid="agreement-ref">{card.agreement_ref}</span></p>}
      </div>
    </section>
  )
}
