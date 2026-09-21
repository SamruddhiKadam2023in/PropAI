import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../../../ui/Modal'
import { errorMessage } from '../../../../utils/http'
import { createProvider, updateProvider } from '../../../../services/serviceProviders'
import { SERVICE_CATEGORIES } from './meta'

const EMPTY = { name: '', category: 'plumber', phone: '', whatsapp: '', sameAsPhone: true, email: '', service_area: '', availability: '', visit_charge: '', status: 'available', problems: '', description: '' }

export default function ProviderForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => (initial ? {
    ...EMPTY, name: initial.name, category: initial.category, phone: initial.phone, whatsapp: initial.whatsapp || '', sameAsPhone: !!initial.whatsapp && initial.whatsapp === initial.phone,
    email: initial.email || '', service_area: initial.service_area, availability: initial.availability || '',
    visit_charge: initial.visit_charge != null ? String(initial.visit_charge) : '', status: initial.status, problems: (initial.problem_types || []).join(', '), description: initial.description || '',
  } : EMPTY))
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const digits = (s) => s.replace(/\D/g, '').length

  const validate = () => {
    const e = {}
    if (form.name.trim().length < 2) e.name = 'Enter the provider or technician name.'
    if (digits(form.phone) < 10) e.phone = 'Enter a valid phone number, e.g. 98765 43210.'
    if (!form.sameAsPhone && form.whatsapp.trim() && digits(form.whatsapp) < 10) e.whatsapp = 'Enter a valid WhatsApp number, or leave it empty.'
    if (form.service_area.trim().length < 2) e.service_area = 'Enter the area they serve, e.g. "Mumbai / Navi Mumbai".'
    if (form.visit_charge !== '' && (Number.isNaN(Number(form.visit_charge)) || Number(form.visit_charge) < 0 || Number(form.visit_charge) > 100000)) e.visit_charge = 'Enter the visit charge in rupees (0 or more).'
    if (form.problems.split(',').filter((p) => p.trim()).length > 8) e.problems = 'List up to 8 problem types.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async (ev) => {
    ev.preventDefault()
    setServerError(null)
    if (!validate()) return
    setSaving(true)
    const payload = {
      name: form.name.trim(), category: form.category, phone: form.phone.trim(),
      whatsapp: form.sameAsPhone ? form.phone.trim() : form.whatsapp.trim() || null,
      email: form.email.trim() || null, service_area: form.service_area.trim(), availability: form.availability.trim() || null,
      visit_charge: form.visit_charge === '' ? null : Number(form.visit_charge), status: form.status,
      description: form.description.trim() || null, problem_types: form.problems.split(',').map((p) => p.trim()).filter(Boolean),
    }
    try {
      const saved = initial ? await updateProvider(initial.id, payload) : await createProvider(payload)
      toast.success(initial ? 'Provider updated' : 'Provider added')
      onSaved(saved)
    } catch (err) { setServerError(errorMessage(err, "We couldn't save this provider.")) }
    finally { setSaving(false) }
  }

  const Err = ({ id }) => (errors[id] ? <p className="text-xs text-danger-fg mt-1" role="alert">{errors[id]}</p> : null)
  return (
    <Modal wide title={initial ? 'Edit service provider' : 'Add a service provider'} subtitle="Only you can see providers you add." onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="provider-form" className="btn-primary flex items-center gap-2" disabled={saving} data-testid="save-provider">
            {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} {initial ? 'Save changes' : 'Add provider'}
          </button>
        </div>
      )}>
      <form id="provider-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="pf-name">Provider / technician name <span className="text-danger-fg" aria-hidden="true">*</span></label>
            <input id="pf-name" className="input" maxLength={150} value={form.name} onChange={set('name')} aria-invalid={!!errors.name} placeholder="Business or technician name" />
            <Err id="name" />
          </div>
          <div>
            <label className="label" htmlFor="pf-category">Service category <span className="text-danger-fg" aria-hidden="true">*</span></label>
            <select id="pf-category" className="input" value={form.category} onChange={set('category')}>
              {SERVICE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="pf-phone">Phone number <span className="text-danger-fg" aria-hidden="true">*</span></label>
            <input id="pf-phone" className="input" inputMode="tel" maxLength={30} value={form.phone} onChange={set('phone')} aria-invalid={!!errors.phone} placeholder="98765 43210" />
            <Err id="phone" />
          </div>
          <div>
            <label className="label" htmlFor="pf-whatsapp">WhatsApp number <span className="text-fg-subtle font-normal">(optional)</span></label>
            <input id="pf-whatsapp" className="input" inputMode="tel" maxLength={30} value={form.sameAsPhone ? form.phone : form.whatsapp} onChange={set('whatsapp')} disabled={form.sameAsPhone} aria-invalid={!!errors.whatsapp} />
            <label className="flex items-center gap-2 mt-2 text-sm text-fg-muted cursor-pointer"><input type="checkbox" checked={form.sameAsPhone} onChange={set('sameAsPhone')} data-testid="same-as-phone" /> Same as phone number</label>
            <Err id="whatsapp" />
          </div>
          <div>
            <label className="label" htmlFor="pf-email">Email <span className="text-fg-subtle font-normal">(optional)</span></label>
            <input id="pf-email" type="email" className="input" maxLength={255} value={form.email} onChange={set('email')} />
          </div>
          <div>
            <label className="label" htmlFor="pf-area">Service area <span className="text-danger-fg" aria-hidden="true">*</span></label>
            <input id="pf-area" className="input" maxLength={150} value={form.service_area} onChange={set('service_area')} aria-invalid={!!errors.service_area} placeholder="Mumbai / Navi Mumbai" />
            <Err id="service_area" />
          </div>
          <div>
            <label className="label" htmlFor="pf-hours">Availability <span className="text-fg-subtle font-normal">(optional)</span></label>
            <input id="pf-hours" className="input" maxLength={80} value={form.availability} onChange={set('availability')} placeholder="9:00 AM – 7:00 PM" />
          </div>
          <div>
            <label className="label" htmlFor="pf-charge">Visit charge (₹) <span className="text-fg-subtle font-normal">(optional)</span></label>
            <input id="pf-charge" type="number" min="0" step="1" inputMode="decimal" className="input" value={form.visit_charge} onChange={set('visit_charge')} aria-invalid={!!errors.visit_charge} placeholder="500" />
            <Err id="visit_charge" />
          </div>
          <div>
            <label className="label" htmlFor="pf-status">Status</label>
            <select id="pf-status" className="input" value={form.status} onChange={set('status')}><option value="available">Available</option><option value="unavailable">Unavailable</option></select>
          </div>
          <div>
            <label className="label" htmlFor="pf-problems">Problem types <span className="text-fg-subtle font-normal">(comma-separated)</span></label>
            <input id="pf-problems" className="input" value={form.problems} onChange={set('problems')} aria-invalid={!!errors.problems} placeholder="Tap leakage, Pipe blockage" />
            <Err id="problems" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="pf-desc">Description <span className="text-fg-subtle font-normal">(optional)</span></label>
            <textarea id="pf-desc" className="input min-h-[72px]" maxLength={500} value={form.description} onChange={set('description')} placeholder="What they do, coverage, anything worth remembering" />
          </div>
        </div>
        {serverError && <div className="p-3 rounded-xl bg-danger-soft text-danger-fg text-sm" role="alert" data-testid="form-error">{serverError}</div>}
      </form>
    </Modal>
  )
}
