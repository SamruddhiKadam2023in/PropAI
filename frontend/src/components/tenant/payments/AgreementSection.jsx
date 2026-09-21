import { AlertTriangle, CheckCircle2, FileText } from 'lucide-react'
import { formatDay } from '../../../utils/dates'
import { formatINR } from '../../../utils/money'
import { SETTLEMENT, agreementStatus } from '../../agreements/meta'

function Figure({ label, value, id, tone = '' }) {
  return <div><dt className="text-xs text-fg-subtle">{label}</dt><dd className={`font-semibold tabular-nums ${tone || 'text-fg'}`} data-testid={id}>{value}</dd></div>
}

function AgreementCard({ a, onPay }) {
  const st = agreementStatus(a.status)
  const early = a.status === 'terminated' || a.status === 'abandoned'
  const owes = a.settlement === 'outstanding'
  const sett = SETTLEMENT[a.settlement] || SETTLEMENT.settled
  return (
    <article className={`card ${owes ? 'border-danger-fg/40' : ''}`} data-testid="agreement-card" data-status={a.status} data-settlement={a.settlement} aria-label={`Agreement ${a.reference}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-fg-subtle uppercase tracking-wide flex items-center gap-1.5"><FileText size={13} aria-hidden="true" /> Agreement <span data-testid="agr-ref">{a.reference}</span></p>
          <p className="font-semibold text-fg mt-1 break-words" data-testid="agr-property">{a.property_title}</p>
          <p className="text-xs text-fg-muted">{formatDay(a.start_date)} to {formatDay(a.end_date)} · {a.term_months} months</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={st.cls} data-testid="agr-status">{st.label}</span>
          {early && <span className={sett.cls} data-testid="agr-settlement">{sett.label}</span>}
        </div>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
        <Figure label="Monthly rent" value={formatINR(a.monthly_rent)} id="agr-rent" />
        <Figure label={`Agreement total (${a.term_months} months)`} value={formatINR(a.contract_total)} id="agr-total" />
        <Figure label="Paid towards it" value={formatINR(a.paid)} id="agr-paid" />
        {early
          ? <Figure label="Still outstanding" value={formatINR(a.abandonment_outstanding)} id="agr-outstanding" tone={owes ? 'text-danger-fg' : 'text-success-fg'} />
          : <Figure label="Owed for leaving early" value={formatINR(0)} id="agr-outstanding" tone="text-success-fg" />}
      </dl>

      {early && owes && (
        <div className="mt-4 p-3 rounded-xl bg-danger-soft text-danger-fg text-sm flex items-start gap-2" role="alert" data-testid="agr-alert">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p>You left this property on <strong>{formatDay(a.terminated_on)}</strong>, before the agreement ended on {formatDay(a.end_date)}. The rent this agreement fixes is still payable:
              {' '}{formatINR(a.contract_total)} − {formatINR(a.paid)} already paid = <strong>{formatINR(a.abandonment_outstanding)}</strong>. No extra charges have been added.</p>
            {a.termination_reason && <p className="text-xs mt-1 opacity-90">Recorded reason: {a.termination_reason}</p>}
            <button type="button" className="btn-primary mt-3" onClick={() => onPay(a)} data-testid="pay-outstanding">Pay outstanding {formatINR(a.abandonment_outstanding)}</button>
          </div>
        </div>
      )}
      {early && !owes && (
        <p className="mt-4 text-sm text-success-fg flex items-center gap-2" data-testid="agr-settled"><CheckCircle2 size={16} aria-hidden="true" /> Ended {formatDay(a.terminated_on)}. Everything under this agreement has been paid.</p>
      )}
      {a.status === 'active' && <p className="mt-4 text-xs text-fg-subtle">Nothing is owed for leaving early while the agreement is running normally. It ends on {formatDay(a.end_date)}.</p>}
    </article>
  )
}

/** The tenant's agreements, with what is still owed after an early exit. The figures come straight from the server. */
export default function AgreementSection({ agreements, onPay }) {
  if (!agreements.length) return null
  return (
    <section aria-label="Your rental agreements" className="space-y-4" data-testid="agreements">
      <h2 className="section-title">Rental agreements</h2>
      {agreements.map((a) => <AgreementCard key={a.id} a={a} onPay={onPay} />)}
    </section>
  )
}
