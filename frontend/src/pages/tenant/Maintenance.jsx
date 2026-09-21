import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Home, RefreshCw, Send, Wrench } from 'lucide-react'
import toast from 'react-hot-toast'
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States'
import { createMaintenanceRequest, listMaintenanceRequests } from '../../services/maintenance'
import { listMyProperties } from '../../services/properties'
import { formatDateTime, timeAgo } from '../../utils/dates'
import { errorMessage } from '../../utils/http'

const CATEGORIES = [
  { value: 'plumbing',     label: 'Plumbing' },
  { value: 'electrical',   label: 'Electrical' },
  { value: 'appliance',    label: 'Appliance' },
  { value: 'furniture',    label: 'Furniture & fittings' },
  { value: 'pest_control', label: 'Pest control' },
  { value: 'cleaning',     label: 'Cleaning' },
  { value: 'structural',   label: 'Walls, roof or structure' },
  { value: 'other',        label: 'Something else' },
]
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]))

const PRIORITIES = [
  { value: 'low',    label: 'Low',    hint: 'Can wait a few days', badge: 'badge-blue' },
  { value: 'medium', label: 'Medium', hint: 'Needs attention soon', badge: 'badge-yellow' },
  { value: 'high',   label: 'High',   hint: 'Urgent, affects daily life', badge: 'badge-red' },
]

const STATUS = {
  open:        { label: 'Open',        cls: 'badge-yellow', step: 0 },
  in_progress: { label: 'In progress', cls: 'badge-blue',   step: 1 },
  resolved:    { label: 'Resolved',    cls: 'badge-green',  step: 2 },
}
const STEPS = ['Submitted', 'In progress', 'Resolved']

const FILTERS = [
  { key: 'all',         label: 'All',         match: () => true },
  { key: 'open',        label: 'Open',        match: (r) => r.status === 'open' },
  { key: 'in_progress', label: 'In progress', match: (r) => r.status === 'in_progress' },
  { key: 'resolved',    label: 'Resolved',    match: (r) => r.status === 'resolved' },
]

const EMPTY_FORM = { title: '', description: '', urgency: 'medium', category: 'other' }
const MAX_DESCRIPTION = 2000

function ProgressSteps({ step }) {
  return (
    <ol className="flex items-center gap-2" aria-label={`Progress: ${STEPS[step]}, step ${step + 1} of ${STEPS.length}`}>
      {STEPS.map((label, i) => (
        <li key={label} className={`flex items-center gap-2 ${i < STEPS.length - 1 ? 'flex-1' : ''}`}>
          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
            i <= step ? 'bg-accent text-accent-on' : 'bg-surface-3 text-fg-muted'}`} aria-hidden="true">
            {i < step ? '✓' : i + 1}
          </span>
          <span className={`text-xs whitespace-nowrap ${i <= step ? 'text-fg font-medium' : 'text-fg-subtle'}`}>{label}</span>
          {i < STEPS.length - 1 && <span className={`h-0.5 flex-1 rounded ${i < step ? 'bg-accent' : 'bg-surface-3'}`} aria-hidden="true" />}
        </li>
      ))}
    </ol>
  )
}

function RequestCard({ request: r }) {
  const status = STATUS[r.status] || { label: r.status || 'Unknown', cls: 'badge-gray', step: 0 }
  const priority = PRIORITIES.find((p) => p.value === r.urgency)
  const updated = r.updated_at && r.updated_at !== r.created_at
  return (
    <article className="card !p-4 space-y-3" data-testid="request-card">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-fg break-words min-w-0">{r.title}</h3>
        <div className="flex flex-wrap justify-end gap-1.5 flex-shrink-0">
          {priority && <span className={priority.badge}>{priority.label} priority</span>}
          <span className={status.cls}>{status.label}</span>
        </div>
      </div>

      <p className={`text-sm whitespace-pre-wrap break-words ${r.description ? 'text-fg-muted' : 'text-fg-subtle italic'}`}>
        {r.description || 'No description provided.'}
      </p>

      <p className="text-xs text-fg-subtle flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="badge-gray">{CATEGORY_LABEL[r.category] || 'Something else'}</span>
        {r.property_title && <span>{r.property_title}</span>}
        <span>· Submitted {formatDateTime(r.created_at)}</span>
        {updated && <span>· Updated {timeAgo(r.updated_at)}</span>}
      </p>

      <ProgressSteps step={status.step} />
    </article>
  )
}

export default function TenantMaintenance() {
  const [home, setHome] = useState({ status: 'loading', properties: [], error: null })
  const [requests, setRequests] = useState({ status: 'loading', items: [], error: null })
  const [form, setForm] = useState(EMPTY_FORM)
  const [propertyId, setPropertyId] = useState(null)
  const [fieldError, setFieldError] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [filter, setFilter] = useState('all')
  const titleRef = useRef(null)

  const loadHome = useCallback(async () => {
    setHome((s) => ({ ...s, status: 'loading' }))
    try {
      const properties = await listMyProperties()
      setHome({ status: 'ready', properties, error: null })
      setPropertyId((cur) => (properties.some((p) => p.id === cur) ? cur : properties[0]?.id ?? null))
    } catch (err) {
      setHome({ status: 'error', properties: [], error: errorMessage(err, "We couldn't load your property.") })
    }
  }, [])

  const loadRequests = useCallback(async (silent = false) => {
    if (!silent) setRequests((s) => ({ ...s, status: 'loading' }))
    try {
      setRequests({ status: 'ready', items: await listMaintenanceRequests(), error: null })
    } catch (err) {
      if (!silent) setRequests({ status: 'error', items: [], error: errorMessage(err, "We couldn't load your requests.") })
    }
  }, [])

  useEffect(() => { loadHome(); loadRequests() }, [loadHome, loadRequests])

  // Pick up status changes made by the owner whenever the tenant comes back to this tab.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') loadRequests(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadRequests])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    const title = form.title.trim()
    if (title.length < 2) {
      setFieldError('Please describe the issue in a few words (at least 2 characters).')
      titleRef.current?.focus()
      return
    }
    setFieldError(null)
    setSubmitError(null)
    setSubmitting(true)
    try {
      const res = await createMaintenanceRequest({
        title, description: form.description.trim(), urgency: form.urgency, category: form.category, property_id: propertyId,
      })
      setRequests((s) => ({ status: 'ready', error: null, items: [res.request, ...s.items.filter((x) => x.id !== res.request.id)] }))
      setForm(EMPTY_FORM)
      setFilter('all')
      toast.success('Request submitted. Your owner has been notified.')
    } catch (err) {
      setSubmitError(errorMessage(err, "We couldn't submit your request. Please try again."))
    } finally {
      setSubmitting(false)
    }
  }

  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, requests.items.filter(f.match).length]))
  const activeFilter = FILTERS.find((f) => f.key === filter) || FILTERS[0]
  const visible = requests.items.filter(activeFilter.match)
  const property = home.properties.find((p) => p.id === propertyId)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-fg">Maintenance Requests</h1>
        <p className="text-sm text-fg-subtle mt-1">Report an issue with your home and track it until it's fixed.</p>
      </div>

      {home.status === 'loading' && <Skeleton className="h-80" />}

      {home.status === 'error' && <ErrorState title="We couldn't load your property" description={home.error} onRetry={loadHome} />}

      {home.status === 'ready' && home.properties.length === 0 && (
        <EmptyState
          icon={Home}
          title="No rented property linked to your account"
          description="Maintenance requests are raised for the home you rent. Once an owner approves your application, you can report issues here."
          action={<Link to="/tenant/search" className="btn-primary">Find a home</Link>}
        />
      )}

      {home.status === 'ready' && property && (
        <form onSubmit={submit} noValidate className="card space-y-5" aria-label="New maintenance request">
          <div>
            <h2 className="section-title">Submit a new request</h2>
            {home.properties.length === 1
              ? <p className="section-subtitle">For {property.title}</p>
              : (
                <div className="mt-2">
                  <label className="label" htmlFor="mr-property">Property</label>
                  <select id="mr-property" className="input" value={propertyId ?? ''} onChange={(e) => setPropertyId(Number(e.target.value))}>
                    {home.properties.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                </div>
              )}
          </div>

          <div>
            <label className="label" htmlFor="mr-title">What needs fixing? <span className="text-danger-fg" aria-hidden="true">*</span></label>
            <input id="mr-title" ref={titleRef} className="input" maxLength={120} placeholder="e.g. Leaking tap in the bathroom"
              value={form.title} onChange={set('title')} aria-required="true"
              aria-invalid={fieldError ? 'true' : 'false'} aria-describedby={fieldError ? 'mr-title-error' : undefined} />
            {fieldError && <p id="mr-title-error" className="text-xs text-danger-fg mt-1.5" role="alert">{fieldError}</p>}
          </div>

          <div>
            <label className="label" htmlFor="mr-category">Category</label>
            <select id="mr-category" className="input" value={form.category} onChange={set('category')}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          <fieldset>
            <legend className="label">How urgent is it?</legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup">
              {PRIORITIES.map((p) => (
                <label key={p.value}
                  className={`cursor-pointer rounded-xl border-2 p-3 transition-colors focus-within:ring-2 focus-within:ring-accent/60 ${
                    form.urgency === p.value ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'}`}>
                  <input type="radio" name="urgency" value={p.value} className="sr-only" checked={form.urgency === p.value} onChange={set('urgency')} />
                  <span className="block text-sm font-semibold text-fg">{p.label}</span>
                  <span className="block text-xs text-fg-muted mt-0.5">{p.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <div className="flex items-baseline justify-between">
              <label className="label" htmlFor="mr-description">Details <span className="text-fg-subtle font-normal">(optional)</span></label>
              <span className="text-xs text-fg-subtle" aria-live="off">{form.description.length}/{MAX_DESCRIPTION}</span>
            </div>
            <textarea id="mr-description" rows={4} maxLength={MAX_DESCRIPTION} className="input resize-y"
              placeholder="When did it start? Which room? Anything the owner should know before visiting?"
              value={form.description} onChange={set('description')} />
          </div>

          {submitError && (
            <div className="p-3 rounded-xl bg-danger-soft text-danger-fg text-sm" role="alert">{submitError}</div>
          )}

          <button type="submit" disabled={submitting} className="btn-primary w-full flex items-center justify-center gap-2">
            <Send size={15} aria-hidden="true" /> {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </form>
      )}

      <section aria-label="Your requests" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="section-title">
            My requests{requests.status === 'ready' ? ` (${requests.items.length})` : ''}
          </h2>
          <button type="button" className="btn-ghost flex items-center gap-1.5" onClick={() => loadRequests()} disabled={requests.status === 'loading'}>
            <RefreshCw size={14} className={requests.status === 'loading' ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
          </button>
        </div>

        {requests.status === 'loading' && (
          <div className="space-y-3" aria-busy="true" aria-label="Loading your requests">
            {[0, 1].map((i) => <Skeleton key={i} className="h-32" />)}
          </div>
        )}

        {requests.status === 'error' && (
          <ErrorState compact title="We couldn't load your requests" description={requests.error} onRetry={() => loadRequests()} />
        )}

        {requests.status === 'ready' && requests.items.length === 0 && (
          <EmptyState icon={Wrench} title="No maintenance requests yet"
            description="When something in your home needs fixing, submit a request above and you can follow its progress here." />
        )}

        {requests.status === 'ready' && requests.items.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter requests">
              {FILTERS.map((f) => (
                <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    filter === f.key ? 'bg-accent text-accent-on' : 'bg-surface-2 text-fg-muted hover:text-fg'}`}>
                  {f.label} <span className="opacity-80">({counts[f.key]})</span>
                </button>
              ))}
            </div>
            {visible.length === 0
              ? <p className="text-sm text-fg-subtle text-center py-8">No requests in this view.</p>
              : <div className="space-y-3">{visible.map((r) => <RequestCard key={r.id} request={r} />)}</div>}
          </>
        )}
      </section>
    </div>
  )
}
