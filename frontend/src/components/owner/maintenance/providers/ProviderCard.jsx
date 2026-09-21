import { Clock, MapPin, MessageCircle, Pencil, Phone, Trash2 } from 'lucide-react'
import { contactLinks, formatPhone } from '../../../../utils/phone'
import { formatINR } from '../../../../utils/money'
import { CATEGORY_ICON, STATUS_BADGE } from './meta'

/**
 * One repair contact. Call / WhatsApp are plain links that open the phone dialler or WhatsApp on the owner's own device -
 * nothing is dialled or sent by PropAI. Demo providers carry fake +91 00000 numbers and are read-only.
 */
export default function ProviderCard({ provider, message, onEdit, onDelete, compact = false }) {
  const Icon = CATEGORY_ICON[provider.category] || CATEGORY_ICON.handyman
  const call = contactLinks(provider.phone)
  const wa = provider.whatsapp ? contactLinks(provider.whatsapp, message) : null
  const status = STATUS_BADGE[provider.status] || STATUS_BADGE.available
  const btn = 'btn-secondary !py-2 !px-3.5 flex items-center justify-center gap-1.5 text-xs min-h-[40px]'

  return (
    <li className="card !p-4 flex flex-col gap-3" data-testid="provider-card" data-id={provider.id} data-demo={provider.is_demo ? 'true' : 'false'} data-status={provider.status}>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-accent-soft text-accent-text flex items-center justify-center flex-shrink-0" aria-hidden="true"><Icon size={18} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-fg break-words" data-testid="provider-name">{provider.name}</h3>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span className="badge-indigo" data-testid="provider-category">{provider.category_label}</span>
            <span className={status.cls} data-testid="provider-status">{status.label}</span>
            {provider.is_demo && <span className="badge-purple" data-testid="provider-demo" title="Sample provider with a fake phone number">Demo</span>}
            {provider.area_match && <span className="badge-blue" data-testid="provider-area-match">Serves this property's city</span>}
          </div>
        </div>
      </div>

      {!compact && provider.problem_types?.length > 0 && (
        <p className="text-sm text-fg-muted" data-testid="provider-problems"><span className="text-fg-subtle">Problem types: </span>{provider.problem_types.join(' • ')}</p>
      )}

      <dl className="text-sm space-y-1.5">
        <div className="flex gap-2"><dt className="text-fg-subtle w-24 flex-shrink-0 flex items-center gap-1"><MapPin size={12} aria-hidden="true" /> Area</dt><dd className="text-fg-muted break-words min-w-0" data-testid="provider-area">{provider.service_area}</dd></div>
        <div className="flex gap-2"><dt className="text-fg-subtle w-24 flex-shrink-0 flex items-center gap-1"><Clock size={12} aria-hidden="true" /> Availability</dt><dd className="text-fg-muted" data-testid="provider-availability">{provider.availability || <span className="italic text-fg-subtle">Not listed</span>}</dd></div>
        <div className="flex gap-2"><dt className="text-fg-subtle w-24 flex-shrink-0">Visit charge</dt><dd className="text-fg font-semibold tabular-nums" data-testid="provider-charge">{provider.visit_charge != null ? formatINR(provider.visit_charge) : <span className="italic font-normal text-fg-subtle">Not listed</span>}</dd></div>
        <div className="flex gap-2"><dt className="text-fg-subtle w-24 flex-shrink-0">Phone</dt><dd className="text-fg tabular-nums" data-testid="provider-phone">{formatPhone(provider.phone) || provider.phone}</dd></div>
      </dl>

      {!compact && provider.description && <p className="text-xs text-fg-subtle break-words" data-testid="provider-description">{provider.description}</p>}
      {!compact && provider.email && <p className="text-xs text-fg-subtle break-all" data-testid="provider-email">{provider.email}</p>}

      <div className="grid grid-cols-2 gap-2 mt-auto">
        {call && (
          <a className={btn} href={call.call} data-testid="provider-call" aria-label={`Call ${provider.name} on ${formatPhone(provider.phone)}`}><Phone size={14} aria-hidden="true" /> Call</a>
        )}
        {wa ? (
          <a className={btn} href={wa.whatsapp} target="_blank" rel="noopener noreferrer" data-testid="provider-whatsapp" aria-label={`Open WhatsApp to message ${provider.name} (opens in a new tab)`}><MessageCircle size={14} aria-hidden="true" /> WhatsApp</a>
        ) : (
          <span className="text-xs text-fg-subtle italic flex items-center justify-center" data-testid="no-whatsapp">No WhatsApp number</span>
        )}
      </div>
      {provider.is_demo && <p className="text-[11px] text-fg-subtle" data-testid="demo-note">Demo provider — the number is a fake placeholder and won't reach anyone.</p>}

      {provider.editable && (onEdit || onDelete) && (
        <div className="flex items-center justify-end gap-1 border-t border-line pt-2 -mb-1">
          {onEdit && <button type="button" className="btn-ghost !py-1 !px-2 flex items-center gap-1 text-xs" onClick={() => onEdit(provider)} aria-label={`Edit ${provider.name}`} data-testid="edit-provider"><Pencil size={13} aria-hidden="true" /> Edit</button>}
          {onDelete && <button type="button" className="btn-ghost !py-1 !px-2 flex items-center gap-1 text-xs text-danger-fg" onClick={() => onDelete(provider)} aria-label={`Remove ${provider.name}`} data-testid="remove-provider"><Trash2 size={13} aria-hidden="true" /> Remove</button>}
        </div>
      )}
    </li>
  )
}
