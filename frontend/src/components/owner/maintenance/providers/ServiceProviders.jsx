import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Search, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { EmptyState, ErrorState, Skeleton } from '../../../ui/States'
import { errorMessage } from '../../../../utils/http'
import { deleteProvider, listProviders } from '../../../../services/serviceProviders'
import ProviderCard from './ProviderCard'
import ProviderForm from './ProviderForm'
import { FILTER_CHIPS } from './meta'

const chip = (on) => `px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${on ? 'bg-accent text-accent-on border-accent' : 'bg-surface text-fg-muted border-line hover:bg-surface-2'}`

/** Owner -> Maintenance -> Service Providers: repair contacts loaded from the backend database. */
export default function ServiceProviders({ initialCategory = 'all' }) {
  const [state, setState] = useState({ status: 'loading', items: [], error: null })
  const [category, setCategory] = useState(initialCategory)
  const [q, setQ] = useState('')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [form, setForm] = useState(null)             // null = closed, { initial } = add/edit
  const [confirm, setConfirm] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }))
    try { setState({ status: 'ready', items: await listProviders(), error: null }) }
    catch (err) { setState({ status: 'error', items: [], error: errorMessage(err, "We couldn't load the service providers.") }) }
  }, [])
  useEffect(() => { load() }, [load])

  const counts = useMemo(() => {
    const c = { all: state.items.length }
    state.items.forEach((p) => { c[p.category] = (c[p.category] || 0) + 1 })
    return c
  }, [state.items])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return state.items
      .filter((p) => category === 'all' || p.category === category)
      .filter((p) => !onlyAvailable || p.status === 'available')
      .filter((p) => !needle || [p.name, p.service_area, p.description, ...(p.problem_types || [])].some((v) => (v || '').toLowerCase().includes(needle)))
  }, [state.items, category, q, onlyAvailable])

  const remove = async () => {
    const p = confirm
    try {
      await deleteProvider(p.id)
      setState((s) => ({ ...s, items: s.items.filter((x) => x.id !== p.id) }))
      toast.success('Provider removed')
    } catch (err) { toast.error(errorMessage(err, "Couldn't remove the provider.")) }
    finally { setConfirm(null) }
  }

  return (
    <section className="space-y-4" data-testid="service-providers">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-fg">Service Providers</h2>
          <p className="text-sm text-fg-subtle mt-0.5">Repair professionals you can call or WhatsApp to fix property issues. Opening Call or WhatsApp uses your own phone — nothing is sent from here.</p>
        </div>
        <button type="button" className="btn-primary flex items-center gap-2" onClick={() => setForm({ initial: null })} data-testid="add-provider"><Plus size={15} aria-hidden="true" /> Add provider</button>
      </div>

      <div className="card !p-4 space-y-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by service category">
          {FILTER_CHIPS.map((f) => (
            <button key={f.key} type="button" className={chip(category === f.key)} aria-pressed={category === f.key} data-testid={`cat-${f.key}`} onClick={() => setCategory(f.key)}>
              {f.chip} <span className="opacity-75 tabular-nums">({counts[f.key] || 0})</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[14rem]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
            <input className="input pl-9" placeholder="Search name, area or problem…" aria-label="Search service providers" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-fg-muted cursor-pointer"><input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} data-testid="only-available" /> Available only</label>
        </div>
      </div>

      {state.status === 'loading' && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading service providers">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56" />)}</div>}
      {state.status === 'error' && <ErrorState title="Couldn't load service providers" description={state.error} onRetry={load} />}
      {state.status === 'ready' && state.items.length === 0 && (
        <EmptyState icon={Users} title="No service providers yet" description="Add the plumbers, electricians and other repair professionals you trust." />
      )}
      {state.status === 'ready' && state.items.length > 0 && (
        <>
          <p className="text-sm text-fg-muted" data-testid="provider-count">{shown.length} provider{shown.length === 1 ? '' : 's'}</p>
          {shown.length === 0
            ? <EmptyState icon={Search} title="No providers match" description="Try another category or clear the search." action={<button type="button" className="btn-secondary" onClick={() => { setCategory('all'); setQ(''); setOnlyAvailable(false) }}>Clear filters</button>} />
            : (
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {shown.map((p) => <ProviderCard key={p.id} provider={p} onEdit={(x) => setForm({ initial: x })} onDelete={setConfirm} />)}
              </ul>
            )}
        </>
      )}

      {confirm && (
        <div className="card !p-4 flex flex-wrap items-center justify-between gap-3 border-danger-fg" role="alertdialog" aria-label={`Confirm removing ${confirm.name}`} data-testid="confirm-remove-box">
          <p className="text-sm text-fg">Remove <strong>{confirm.name}</strong> from your service providers?</p>
          <div className="flex gap-2"><button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>Keep</button><button type="button" className="btn-danger" onClick={remove} data-testid="confirm-remove">Yes, remove</button></div>
        </div>
      )}
      {form && <ProviderForm initial={form.initial} onClose={() => setForm(null)} onSaved={() => { setForm(null); load() }} />}
    </section>
  )
}
