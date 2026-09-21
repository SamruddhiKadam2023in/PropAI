import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Plus, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States'
import CurrentPayment from '../../components/tenant/payments/CurrentPayment'
import RecordPaymentModal from '../../components/tenant/payments/RecordPaymentModal'
import AgreementSection from '../../components/tenant/payments/AgreementSection'
import TransactionList from '../../components/tenant/payments/TransactionList'
import { getPaymentSummary, listTransactions, downloadReceipt } from '../../services/payments'
import { formatINR } from '../../utils/money'
import { errorMessage } from '../../utils/http'

function saveBlob(res, fallbackName) {
  const named = /filename="?([^";]+)"?/i.exec(res.headers?.['content-disposition'] || '')
  const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url; a.download = named?.[1] || fallbackName
  document.body.appendChild(a); a.click(); a.remove()
  window.URL.revokeObjectURL(url)
}

export default function TenantPayments() {
  const [state, setState] = useState({ status: 'loading', summary: null, items: [], error: null })
  const [recording, setRecording] = useState(false)
  const [settling, setSettling] = useState(null)
  const [receiptId, setReceiptId] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: null }))
    try {
      const [summary, items] = await Promise.all([getPaymentSummary(), listTransactions()])
      setState({ status: 'ready', summary, items, error: null })
    } catch (err) {
      setState({ status: 'error', summary: null, items: [], error: errorMessage(err, "We couldn't load your payments.") })
    }
  }, [])
  useEffect(() => { load() }, [load])

  const receipt = async (t) => {
    setReceiptId(t.id)
    try { saveBlob(await downloadReceipt(t.id), `receipt_${t.id}.pdf`) }
    catch (err) {
      let message = "We couldn't download the receipt."
      try { const d = JSON.parse(await err?.response?.data?.text?.())?.detail; if (typeof d === 'string') message = d } catch { /* not JSON */ }
      toast.error(message)
    } finally { setReceiptId(null) }
  }

  const { status, summary, items, error } = state
  const cards = summary?.properties || []
  const agreements = summary?.agreements || []

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg">Payments</h1>
          <p className="text-fg-subtle text-sm mt-0.5">What you owe this month and every payment you have made</p>
        </div>
        {status === 'ready' && cards.length > 0 && (
          <button type="button" className="btn-primary flex items-center gap-2" onClick={() => setRecording(true)} data-testid="record-payment"><Plus size={15} aria-hidden="true" /> Record a payment</button>
        )}
      </div>

      {status === 'loading' && (
        <div className="space-y-4" role="status" aria-label="Loading your payments" data-testid="payments-loading">
          <Skeleton className="h-44" /><div className="grid grid-cols-3 gap-4"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div><Skeleton className="h-72" />
        </div>
      )}

      {status === 'error' && <ErrorState title="Couldn't load your payments" description={error} onRetry={load} />}

      {status === 'ready' && (
        <>
          {summary.outstanding_total > 0 && (
            <div className="p-4 rounded-2xl bg-danger-soft text-danger-fg flex items-start gap-3" role="alert" data-testid="outstanding-banner">
              <AlertTriangle size={20} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">You have <span data-testid="outstanding-total">{formatINR(summary.outstanding_total)}</span> outstanding</p>
                <p className="text-sm mt-0.5">This is rent still owed under an agreement you left before it ended. See the agreement below to pay it.</p>
              </div>
            </div>
          )}

          {cards.length === 0 && agreements.length === 0 ? (
            <EmptyState icon={Wallet} title="No rented property yet" description="Once an owner approves your rental application, what you owe each month will appear here." />
          ) : (
            <div className="space-y-4">{cards.map((c) => <CurrentPayment key={c.property_id} card={c} />)}</div>
          )}

          <AgreementSection agreements={agreements} onPay={setSettling} />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="totals">
            {[
              ['Total paid', formatINR(summary.totals.total_paid), 'total-paid'],
              ['Completed payments', String(summary.totals.completed), 'total-completed'],
              ['All transactions', String(summary.totals.transactions), 'total-transactions'],
            ].map(([label, value, id]) => (
              <div key={id} className="card !p-4"><p className="text-xs font-medium text-fg-subtle uppercase tracking-wide">{label}</p><p className="text-xl font-bold text-fg mt-1 tabular-nums" data-testid={id}>{value}</p></div>
            ))}
          </div>

          <section className="card">
            <h2 className="section-title mb-4">Transaction history</h2>
            <TransactionList items={items} busyId={receiptId} onReceipt={receipt} />
          </section>
        </>
      )}

      {settling && summary && (
        <RecordPaymentModal properties={cards} today={summary.today}
          settlement={{ agreement_id: settling.id, property_id: settling.property_id, title: settling.property_title, reference: settling.reference, outstanding: settling.abandonment_outstanding }}
          onClose={() => setSettling(null)} onSaved={() => { setSettling(null); load() }} />
      )}

      {recording && summary && (
        <RecordPaymentModal properties={cards} today={summary.today} defaultPropertyId={cards[0]?.property_id}
          onClose={() => setRecording(false)} onSaved={() => { setRecording(false); load() }} />
      )}
    </div>
  )
}
