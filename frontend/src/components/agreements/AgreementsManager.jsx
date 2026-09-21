import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FilePlus2, FileText, Loader2, LogOut, SearchX } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../ui/Modal'
import { EmptyState, ErrorState, Skeleton } from '../ui/States'
import api from '../../services/api'
import { endAgreement, listAgreements, recordAgreement } from '../../services/agreements'
import { formatDay } from '../../utils/dates'
import { formatINR } from '../../utils/money'
import { errorMessage } from '../../utils/http'
import { SETTLEMENT, agreementStatus } from './meta'

const FILTERS = [
  ['all', 'All'], ['active', 'Active'], ['outstanding', 'Outstanding'], ['terminated', 'Terminated'], ['abandoned', 'Abandoned'], ['completed', 'Completed'],
]

function StatusBadges({ a }) {
  const st = agreementStatus(a.status)
  const early = a.status === 'terminated' || a.status === 'abandoned'
  const sett = SETTLEMENT[a.settlement]
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={st.cls} data-testid="ag-status">{st.label}</span>
      {early && sett && <span className={sett.cls} data-testid="ag-settlement">{sett.label}</span>}
    </div>
  )
}

function EndModal({ agreement, today, onClose, onDone }) {
  const [kind, setKind] = useState('abandoned')
  const [leftOn, setLeftOn] = useState(today)
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const submit = async (ev) => {
    ev.preventDefault()
    setError(null)
    if (!leftOn) return setError('Choose the day the tenant left.')
    if (leftOn > today) return setError("The day the tenant left can't be in the future.")
    if (leftOn < agreement.start_date) return setError("The tenant can't leave before the agreement started.")
    if (reason.length > 500) return setError('Keep the reason under 500 characters.')
    setSaving(true)
    try {
      const done = await endAgreement(agreement.id, { status: kind, terminated_on: leftOn, reason: reason.trim() || null })
      toast.success(`Recorded as ${done.status}`)
      onDone(done)
    } catch (err) { setError(errorMessage(err, "We couldn't record this.")) }
    finally { setSaving(false) }
  }

  return (
    <Modal title="Record tenant leaving early" subtitle={`${agreement.reference} · ${agreement.tenant_name} · ${agreement.property_title}`} onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="end-agreement" className="btn-primary flex items-center gap-2" disabled={saving} data-testid="confirm-end">
            {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Record and calculate
          </button>
        </div>
      )}>
      <form id="end-agreement" onSubmit={submit} noValidate className="space-y-4">
        <fieldset>
          <legend className="label">What happened?</legend>
          <div className="grid sm:grid-cols-2 gap-2">
            {[['abandoned', 'Abandoned', 'Left without formally ending the agreement'], ['terminated', 'Terminated', 'Left and the agreement was formally ended']].map(([v, l, d]) => (
              <label key={v} className={`flex items-start gap-2 p-3 rounded-xl border cursor-pointer ${kind === v ? 'border-accent bg-accent-soft' : 'border-line'}`}>
                <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v)} className="mt-1" />
                <span><span className="block font-semibold text-fg text-sm">{l}</span><span className="block text-xs text-fg-muted">{d}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="label" htmlFor="ea-date">Day the tenant left</label>
          <input id="ea-date" type="date" className="input" min={agreement.start_date} max={today} value={leftOn} onChange={(e) => setLeftOn(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="ea-reason">Reason <span className="text-fg-subtle font-normal">(optional)</span></label>
          <textarea id="ea-reason" className="input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="p-3 rounded-xl bg-surface-2 text-sm text-fg-muted" data-testid="end-explainer">
          The tenant stays responsible for the rent this agreement fixes ({formatINR(agreement.monthly_rent)} × {agreement.term_months} = {formatINR(agreement.contract_total)}),
          less the {formatINR(agreement.paid)} already paid. The property is released. No penalties or fees are added.
        </div>
        {error && <div className="p-3 rounded-xl bg-danger-soft text-danger-fg text-sm" role="alert" data-testid="end-error">{error}</div>}
      </form>
    </Modal>
  )
}

function RecordModal({ today, running, onClose, onDone }) {
  const [options, setOptions] = useState(null)
  const [form, setForm] = useState({ property_id: '', start_date: today, term_months: '12', monthly_rent: '' })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    api.get('/properties/').then((r) => {
      const free = r.data.filter((p) => p.tenant_id && !running.has(p.id))
      setOptions(free)
      if (free[0]) setForm((f) => ({ ...f, property_id: String(free[0].id) }))
    }).catch((err) => { setOptions([]); setError(errorMessage(err, "We couldn't load your properties.")) })
  }, [running])

  const submit = async (ev) => {
    ev.preventDefault()
    setError(null)
    const term = Number(form.term_months)
    if (!form.property_id) return setError('Choose a property that has a tenant.')
    if (!form.start_date || form.start_date > today) return setError("The start date can't be empty or in the future.")
    if (!Number.isInteger(term) || term < 1 || term > 120) return setError('The term must be between 1 and 120 months.')
    if (form.monthly_rent !== '' && !(Number(form.monthly_rent) > 0)) return setError('The monthly rent must be more than ₹0.')
    setSaving(true)
    try {
      const done = await recordAgreement({
        property_id: Number(form.property_id), start_date: form.start_date, term_months: term,
        ...(form.monthly_rent !== '' ? { monthly_rent: Number(form.monthly_rent) } : {}),
      })
      toast.success('Agreement recorded')
      onDone(done)
    } catch (err) { setError(errorMessage(err, "We couldn't record this agreement.")) }
    finally { setSaving(false) }
  }

  return (
    <Modal title="Record an agreement" subtitle="The rent and term that fix what the tenant owes if they leave early." onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="record-agreement" className="btn-primary flex items-center gap-2" disabled={saving || !options?.length} data-testid="save-agreement">
            {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Record agreement
          </button>
        </div>
      )}>
      <form id="record-agreement" onSubmit={submit} noValidate className="space-y-4">
        {options && options.length === 0 && <p className="text-sm text-fg-muted" data-testid="no-options">Every rented property already has a running agreement.</p>}
        <div>
          <label className="label" htmlFor="ra-prop">Property</label>
          <select id="ra-prop" className="input" value={form.property_id} onChange={set('property_id')} disabled={!options?.length}>
            {(options || []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <div><label className="label" htmlFor="ra-start">Start date</label><input id="ra-start" type="date" className="input" max={today} value={form.start_date} onChange={set('start_date')} /></div>
          <div><label className="label" htmlFor="ra-term">Term (months)</label><input id="ra-term" type="number" min="1" max="120" className="input" value={form.term_months} onChange={set('term_months')} /></div>
          <div><label className="label" htmlFor="ra-rent">Monthly rent (₹)</label><input id="ra-rent" type="number" min="0" step="0.01" className="input" placeholder="Property rent" value={form.monthly_rent} onChange={set('monthly_rent')} /></div>
        </div>
        {error && <div className="p-3 rounded-xl bg-danger-soft text-danger-fg text-sm" role="alert" data-testid="record-error">{error}</div>}
      </form>
    </Modal>
  )
}

/** Agreements for Owners (their own properties) and Managers (all): status, what is outstanding after an early exit, and the action to record one. */
export default function AgreementsManager() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null })
  const [filter, setFilter] = useState('all')
  const [ending, setEnding] = useState(null)
  const [recording, setRecording] = useState(false)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: null }))
    try { setState({ status: 'ready', data: await listAgreements(filter), error: null }) }
    catch (err) { setState({ status: 'error', data: null, error: errorMessage(err, "We couldn't load agreements.") }) }
  }, [filter])
  useEffect(() => { load() }, [load])

  const { status, data, error } = state
  const items = data?.items || []
  const today = items[0]?.today || new Date().toLocaleDateString('en-CA')
  const running = useMemo(() => new Set(items.filter((a) => a.status === 'active').map((a) => a.property_id)), [items])

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg">Agreements</h1>
          <p className="text-fg-subtle text-sm mt-0.5">Rental agreements, and what tenants still owe after leaving early</p>
        </div>
        <button type="button" className="btn-primary flex items-center gap-2" onClick={() => setRecording(true)} data-testid="record-agreement"><FilePlus2 size={15} aria-hidden="true" /> Record agreement</button>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter agreements">
        {FILTERS.map(([v, l]) => (
          <button key={v} type="button" onClick={() => setFilter(v)} aria-pressed={filter === v} data-testid={`filter-${v}`}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border ${filter === v ? 'bg-accent text-white border-accent' : 'border-line text-fg-muted hover:bg-surface-2'}`}>{l}</button>
        ))}
      </div>

      {status === 'loading' && <div className="space-y-3" role="status" aria-label="Loading agreements" data-testid="agreements-loading"><Skeleton className="h-20" /><Skeleton className="h-64" /></div>}
      {status === 'error' && <ErrorState title="Couldn't load agreements" description={error} onRetry={load} />}

      {status === 'ready' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="ag-totals">
            {[
              ['Agreements', String(data.totals.agreements), 'tot-agreements'],
              ['Left early', String(data.totals.early_exits), 'tot-early'],
              ['Owing money', String(data.totals.with_outstanding), 'tot-owing'],
              ['Total outstanding', formatINR(data.totals.outstanding_total), 'tot-outstanding'],
            ].map(([label, value, id]) => (
              <div key={id} className="card !p-4"><p className="text-xs font-medium text-fg-subtle uppercase tracking-wide">{label}</p><p className={`text-xl font-bold mt-1 tabular-nums ${id === 'tot-outstanding' && data.totals.outstanding_total > 0 ? 'text-danger-fg' : 'text-fg'}`} data-testid={id}>{value}</p></div>
            ))}
          </div>

          {items.length === 0 ? (
            filter === 'all'
              ? <EmptyState icon={FileText} title="No agreements yet" description="An agreement is recorded automatically when you approve a rental application, or you can record one for a current tenant." />
              : <EmptyState icon={SearchX} title="No agreements match" description="Try a different filter." action={<button type="button" className="btn-secondary" onClick={() => setFilter('all')}>Show all</button>} />
          ) : (
            <ul className="space-y-3" data-testid="agreement-list">
              {items.map((a) => {
                const early = a.status === 'terminated' || a.status === 'abandoned'
                return (
                  <li key={a.id} className="card" data-testid="agreement-row" data-id={a.id} data-status={a.status} data-settlement={a.settlement}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-fg-subtle font-mono" data-testid="ag-ref">{a.reference}</p>
                        <p className="font-semibold text-fg break-words" data-testid="ag-tenant">{a.tenant_name}</p>
                        <p className="text-sm text-fg-muted break-words" data-testid="ag-property">{a.property_title}</p>
                        <p className="text-xs text-fg-subtle mt-0.5">{formatDay(a.start_date)} to {formatDay(a.end_date)} · {a.term_months} months · {formatINR(a.monthly_rent)}/month</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <StatusBadges a={a} />
                        {a.can_end_early && (
                          <button type="button" className="btn-secondary !py-1.5 flex items-center gap-1.5 text-sm" onClick={() => setEnding(a)} data-testid="end-agreement"><LogOut size={14} aria-hidden="true" /> Tenant left early</button>
                        )}
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-sm">
                      <div><dt className="text-xs text-fg-subtle">Agreement total</dt><dd className="font-semibold text-fg tabular-nums" data-testid="ag-total">{formatINR(a.contract_total)}</dd></div>
                      <div><dt className="text-xs text-fg-subtle">Paid towards it</dt><dd className="font-semibold text-fg tabular-nums" data-testid="ag-paid">{formatINR(a.paid)}</dd></div>
                      <div><dt className="text-xs text-fg-subtle">Left on</dt><dd className="font-semibold text-fg" data-testid="ag-left">{early ? formatDay(a.terminated_on) : '—'}</dd></div>
                      <div><dt className="text-xs text-fg-subtle">Outstanding</dt><dd className={`font-semibold tabular-nums ${a.settlement === 'outstanding' ? 'text-danger-fg' : 'text-fg'}`} data-testid="ag-outstanding">{early ? formatINR(a.abandonment_outstanding) : '—'}</dd></div>
                    </dl>
                    {early && a.termination_reason && <p className="text-xs text-fg-muted mt-2 break-words" data-testid="ag-reason">Reason: {a.termination_reason}</p>}
                    {a.settlement === 'outstanding' && (
                      <p className="mt-2 text-xs text-danger-fg flex items-center gap-1.5"><AlertTriangle size={13} aria-hidden="true" /> The tenant has been told this is still owed. It reduces automatically as they pay.</p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {ending && <EndModal agreement={ending} today={today} onClose={() => setEnding(null)} onDone={() => { setEnding(null); load() }} />}
      {recording && <RecordModal today={today} running={running} onClose={() => setRecording(false)} onDone={() => { setRecording(false); load() }} />}
    </div>
  )
}
