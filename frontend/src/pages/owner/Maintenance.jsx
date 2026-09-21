import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, LayoutGrid, RefreshCw, Search, Table2, Wrench } from 'lucide-react'
import toast from 'react-hot-toast'
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States'
import RecordsTable from '../../components/owner/maintenance/RecordsTable'
import RecordCards from '../../components/owner/maintenance/RecordCards'
import RecordDetails from '../../components/owner/maintenance/RecordDetails'
import ServiceForm from '../../components/owner/maintenance/ServiceForm'
import ServiceProviders from '../../components/owner/maintenance/providers/ServiceProviders'
import { CATEGORY_LABEL, STATUS, serviceDate } from '../../components/owner/maintenance/meta'
import { getMaintenanceSummary, listOwnerRequests, updateOwnerRequestStatus } from '../../services/ownerMaintenance'
import { errorMessage } from '../../utils/http'
import { formatINR, fromCents, recordMoney, sumCents } from '../../utils/money'

const PAGE_SIZE = 10
const VIEW_KEY = 'owner-maintenance-view'
const readPref = (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : v } catch { return fallback } }
const writePref = (key, value) => { try { localStorage.setItem(key, String(value)) } catch { /* preference just won't persist */ } }

const SORTS = {
  date_desc:  { label: 'Date: newest first',  cmp: (a, b) => serviceDate(b).localeCompare(serviceDate(a)) },
  date_asc:   { label: 'Date: oldest first',  cmp: (a, b) => serviceDate(a).localeCompare(serviceDate(b)) },
  total_desc: { label: 'Total: high to low',  cmp: (a, b) => (recordMoney(b)?.total ?? -1) - (recordMoney(a)?.total ?? -1) },
  total_asc:  { label: 'Total: low to high',  cmp: (a, b) => (recordMoney(a)?.total ?? Infinity) - (recordMoney(b)?.total ?? Infinity) },
}
const DEFAULT_FILTERS = { status: 'all', property: 'all', category: 'all', q: '', sort: 'date_desc' }

function StatCard({ title, value, sub, tone, testId }) {
  return (
    <div className="stat-card" data-testid={testId}>
      <div className="min-w-0">
        <p className="text-xs font-medium text-fg-subtle uppercase tracking-wide">{title}</p>
        <p className={`text-xl font-bold mt-0.5 tabular-nums ${tone || 'text-fg'}`} data-value>{value}</p>
        {sub && <p className="text-xs text-fg-subtle mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function Breakdown({ title, rows, labelOf }) {
  const max = Math.max(1, ...rows.map((r) => r.total))
  return (
    <div className="card" data-testid={`breakdown-${title.toLowerCase().replace(/\W+/g, '-')}`}>
      <h3 className="section-title mb-3 !text-base">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-fg-subtle">No service fees recorded yet.</p> : (
        <ul className="space-y-3">
          {rows.slice(0, 6).map((r) => (
            <li key={labelOf(r)}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-fg-muted truncate">{labelOf(r)} <span className="text-xs text-fg-subtle">({r.count})</span></span>
                <span className="font-semibold text-fg tabular-nums">{formatINR(r.total)}</span>
              </div>
              <div className="progress-bar mt-1"><div className="progress-fill bg-accent" style={{ width: `${Math.max(3, (r.total / max) * 100)}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function OwnerMaintenance() {
  const [state, setState] = useState({ status: 'loading', records: [], error: null })
  const [summary, setSummary] = useState(null)
  const [view, setView] = useState(() => (readPref(VIEW_KEY, 'table') === 'cards' ? 'cards' : 'table'))
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const [detailsId, setDetailsId] = useState(null)
  const [editing, setEditing] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [tab, setTab] = useState('requests')                 // requests | providers
  const [providerCategory, setProviderCategory] = useState('all')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }))
    try {
      setState({ status: 'ready', records: await listOwnerRequests(), error: null })
    } catch (err) {
      setState({ status: 'error', records: [], error: errorMessage(err, "We couldn't load your maintenance records.") })
    }
  }, [])

  const loadSummary = useCallback(async () => {
    try { setSummary(await getMaintenanceSummary()) } catch { setSummary(null) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { setPage(1) }, [filters])

  const changeView = (v) => { setView(v); writePref(VIEW_KEY, v) }
  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }))

  const scoped = state.records

  const propertyOptions = useMemo(() => {
    const seen = new Map()
    scoped.forEach((r) => seen.set(String(r.property_id), r.property_title || `Property ${r.property_id}`))
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [scoped])
  const categoryOptions = useMemo(() => [...new Set(scoped.map((r) => r.category || 'other'))].sort(), [scoped])

  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return scoped
      .filter((r) => filters.status === 'all' || r.status === filters.status)
      .filter((r) => filters.property === 'all' || String(r.property_id) === filters.property)
      .filter((r) => filters.category === 'all' || (r.category || 'other') === filters.category)
      .filter((r) => !q || [r.title, r.description, r.property_title, r.tenant_name, r.service?.provider_name, r.service?.service_type, r.service?.invoice_no]
        .some((v) => (v || '').toLowerCase().includes(q)))
      .sort(SORTS[filters.sort].cmp)
  }, [scoped, filters])

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageItems = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const totals = useMemo(() => {
    const priced = visible.map(recordMoney).filter(Boolean)
    return {
      count: visible.length,
      withService: priced.length,
      fee: fromCents(sumCents(priced.map((m) => m.fee))),
      additional: fromCents(sumCents(priced.map((m) => m.additional))),
      total: fromCents(sumCents(priced.map((m) => m.total))),
    }
  }, [visible])

  const statusCounts = useMemo(() => Object.fromEntries(['open', 'in_progress', 'resolved'].map((s) => [s, scoped.filter((r) => r.status === s).length])), [scoped])
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS)
  const details = scoped.find((r) => r.id === detailsId) || null

  const patchRecord = (id, patch) => setState((s) => ({ ...s, records: s.records.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))

  const changeStatus = async (record, status) => {
    const previous = record.status
    setBusyId(record.id)
    patchRecord(record.id, { status })
    try {
      await updateOwnerRequestStatus(record.id, status)
      toast.success(`Marked as ${STATUS[status].label.toLowerCase()}`)
      loadSummary()
    } catch (err) {
      patchRecord(record.id, { status: previous })
      toast.error(errorMessage(err, "Couldn't update the status."))
    } finally { setBusyId(null) }
  }

  const onSaved = (saved) => {
    setState((s) => ({ ...s, records: s.records.map((r) => (r.id === saved.id ? saved : r)) }))
    setEditing(null)
    loadSummary()
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg">Maintenance</h1>
          <p className="text-sm text-fg-subtle mt-0.5">Requests from your tenants and the service work, providers and fees behind them.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => { load(); loadSummary() }} disabled={state.status === 'loading'}>
            <RefreshCw size={14} className={state.status === 'loading' ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-line" role="tablist" aria-label="Maintenance sections">
        {[['requests', 'Maintenance requests'], ['providers', 'Service providers']].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} data-testid={`section-${key}`} onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-t-lg ${tab === key ? 'border-accent text-accent-text' : 'border-transparent text-fg-muted hover:text-fg'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'providers' && <ServiceProviders key={providerCategory} initialCategory={providerCategory} />}

      {tab === 'requests' && (<>
      {state.status === 'loading' && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading maintenance records">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
          <Skeleton className="h-96" />
        </div>
      )}

      {state.status === 'error' && <ErrorState title="We couldn't load your maintenance records" description={state.error} onRetry={load} />}

      {state.status === 'ready' && scoped.length === 0 && (
        <EmptyState icon={Wrench} title="No maintenance requests yet"
          description="When a tenant reports an issue it will appear here, and you can record the service provider and fees against it." />
      )}

      {state.status === 'ready' && scoped.length > 0 && (
        <>
          <section aria-label="Summary" className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard testId="stat-records" title="Records" value={summary ? summary.records : scoped.length}
                sub={`${statusCounts.open} open · ${statusCounts.in_progress} in progress · ${statusCounts.resolved} resolved`} />
              <StatCard testId="stat-billed" title="Total billed" value={summary ? formatINR(summary.total_billed) : '—'}
                sub={summary ? `${summary.records_with_service} record${summary.records_with_service === 1 ? '' : 's'} with fees` : ''} />
              <StatCard testId="stat-paid" title="Paid" value={summary ? formatINR(summary.paid) : '—'} tone="text-success-fg" />
              <StatCard testId="stat-pending" title="Payment pending" value={summary ? formatINR(summary.pending) : '—'} tone="text-warning-fg" />
            </div>
            {summary && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Breakdown title="Spend by category" rows={summary.by_category} labelOf={(r) => CATEGORY_LABEL[r.category] || 'Other'} />
                <Breakdown title="Spend by property" rows={summary.by_property} labelOf={(r) => r.property_title || `Property ${r.property_id}`} />
              </div>
            )}
          </section>

          <section aria-label="Records" className="space-y-4">
            <div className="card !p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[14rem]">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
                  <input className="input pl-9" type="search" placeholder="Search title, provider, property, invoice…" aria-label="Search maintenance records"
                    value={filters.q} onChange={setFilter('q')} />
                </div>
                <select className="input w-auto" aria-label="Filter by property" value={filters.property} onChange={setFilter('property')}>
                  <option value="all">All properties</option>
                  {propertyOptions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
                </select>
                <select className="input w-auto" aria-label="Filter by category" value={filters.category} onChange={setFilter('category')}>
                  <option value="all">All categories</option>
                  {categoryOptions.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c] || c}</option>)}
                </select>
                <select className="input w-auto" aria-label="Sort records" value={filters.sort} onChange={setFilter('sort')}>
                  {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                </select>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
                  {[['all', 'All', scoped.length], ['open', 'Open', statusCounts.open], ['in_progress', 'In progress', statusCounts.in_progress], ['resolved', 'Resolved', statusCounts.resolved]].map(([key, label, n]) => (
                    <button key={key} type="button" role="tab" aria-selected={filters.status === key} onClick={() => setFilters((f) => ({ ...f, status: key }))}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${filters.status === key ? 'bg-accent text-accent-on' : 'bg-surface-2 text-fg-muted hover:text-fg'}`}>
                      {label} <span className="opacity-80">({n})</span>
                    </button>
                  ))}
                </div>
                <div className="inline-flex rounded-xl border border-line overflow-hidden" role="group" aria-label="Choose view">
                  {[['table', Table2, 'Table'], ['cards', LayoutGrid, 'Cards']].map(([key, Icon, label]) => (
                    <button key={key} type="button" aria-pressed={view === key} onClick={() => changeView(key)} data-testid={`view-${key}`}
                      className={`px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-colors ${view === key ? 'bg-accent text-accent-on' : 'bg-surface text-fg-muted hover:text-fg'}`}>
                      <Icon size={14} aria-hidden="true" /> {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {visible.length === 0 ? (
              <EmptyState icon={Search} title="No records match your filters" description="Try a different search or clear the filters."
                action={filtersActive ? <button type="button" className="btn-secondary" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</button> : null} />
            ) : (
              <>
                {view === 'table'
                  ? <RecordsTable records={pageItems} totals={totals} onOpen={(r) => setDetailsId(r.id)} onStatus={changeStatus} busyId={busyId} />
                  : <RecordCards records={pageItems} totals={totals} onOpen={(r) => setDetailsId(r.id)} onStatus={changeStatus} busyId={busyId} />}

                <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-fg-muted" data-testid="pager">
                  <p>Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, visible.length)} of {visible.length}</p>
                  {pageCount > 1 && (
                    <div className="flex items-center gap-2">
                      <button type="button" className="btn-secondary !py-1.5 !px-3 flex items-center gap-1" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}><ChevronLeft size={14} aria-hidden="true" /> Previous</button>
                      <span aria-live="polite">Page {safePage} of {pageCount}</span>
                      <button type="button" className="btn-secondary !py-1.5 !px-3 flex items-center gap-1" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Next <ChevronRight size={14} aria-hidden="true" /></button>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </>
      )}

      </>)}

      {details && !editing && (
        <RecordDetails record={details} onClose={() => setDetailsId(null)} onStatus={changeStatus} onEdit={(r) => setEditing(r)} busy={busyId === details.id}
          onViewProviders={(category) => { setDetailsId(null); setProviderCategory(category); setTab('providers') }} />
      )}
      {editing && <ServiceForm record={editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  )
}
