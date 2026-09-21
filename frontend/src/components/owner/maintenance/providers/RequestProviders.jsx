import { useEffect, useState } from 'react'
import { ArrowRight, Wrench } from 'lucide-react'
import { ErrorState, Skeleton } from '../../../ui/States'
import { errorMessage } from '../../../../utils/http'
import { providersForRequest } from '../../../../services/serviceProviders'
import { CATEGORY_LABEL } from '../meta'
import ProviderCard from './ProviderCard'

const HOW = { request_category: "based on the request's category", keywords: 'based on the wording of the request', default: 'no specific trade matched, so a general handyman is suggested' }

/** Inside a maintenance request: Problem type -> Recommended service category -> Available providers -> Phone / WhatsApp / fee. */
export default function RequestProviders({ record, onViewAll }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null })
  useEffect(() => {
    let live = true
    setState({ status: 'loading', data: null, error: null })
    providersForRequest(record.id)
      .then((data) => live && setState({ status: 'ready', data, error: null }))
      .catch((err) => live && setState({ status: 'error', data: null, error: errorMessage(err, "We couldn't load service providers for this request.") }))
    return () => { live = false }
  }, [record.id])

  const message = `Hello, I need help at ${record.property_title || 'my property'}: "${record.title}". Are you available?`
  const { status, data, error } = state
  return (
    <section className="rounded-2xl border border-line bg-surface-2/40 p-4 space-y-3" data-testid="request-providers" aria-label="Contact a service provider">
      <h3 className="font-semibold text-fg flex items-center gap-2"><Wrench size={16} aria-hidden="true" /> Contact a service provider</h3>
      {status === 'loading' && <div role="status" aria-label="Finding service providers"><Skeleton className="h-24" /></div>}
      {status === 'error' && <ErrorState compact title="Couldn't load providers" description={error} />}
      {status === 'ready' && (
        <>
          <ol className="text-sm grid gap-2 sm:grid-cols-3" data-testid="provider-flow">
            <li className="rounded-xl bg-surface p-3"><p className="text-xs text-fg-subtle">Problem type</p><p className="font-semibold text-fg" data-testid="flow-problem">{CATEGORY_LABEL[record.category] || 'Other'}</p></li>
            <li className="rounded-xl bg-surface p-3"><p className="text-xs text-fg-subtle">Recommended service</p><p className="font-semibold text-fg" data-testid="flow-category">{data.suggestion.label}</p><p className="text-[11px] text-fg-subtle">{HOW[data.suggestion.source]}</p></li>
            <li className="rounded-xl bg-surface p-3"><p className="text-xs text-fg-subtle">Available providers</p><p className="font-semibold text-fg" data-testid="flow-count">{data.providers.length}{data.unavailable_count ? ` (+${data.unavailable_count} unavailable)` : ''}</p></li>
          </ol>
          {data.providers.length === 0 ? (
            <p className="text-sm text-fg-muted" data-testid="no-providers">No available {data.suggestion.label.toLowerCase()} providers yet. Add one under Service Providers.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">{data.providers.map((p) => <ProviderCard key={p.id} provider={p} message={message} compact />)}</ul>
          )}
          <button type="button" className="btn-ghost !px-2 !py-1 flex items-center gap-1 text-xs" onClick={() => onViewAll(data.suggestion.category)} data-testid="view-all-providers">
            View all {data.suggestion.label} providers <ArrowRight size={13} aria-hidden="true" />
          </button>
        </>
      )}
    </section>
  )
}
