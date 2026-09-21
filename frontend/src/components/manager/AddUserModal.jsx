import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../ui/Modal'
import api from '../../services/api'
import { errorMessage } from '../../utils/http'

const ROLES = [['tenant', 'Tenant'], ['owner', 'Property Owner'], ['manager', 'Manager']]

/** A Manager creates an account for someone else. This is the only place a new Manager account can come from. */
export default function AddUserModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', role: 'tenant' })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (ev) => {
    ev.preventDefault()
    setError(null)
    if (!form.full_name.trim()) return setError('Enter the person\'s name.')
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return setError('Enter a valid email address.')
    if (form.password.length < 8) return setError('The password must be at least 8 characters.')
    if (new TextEncoder().encode(form.password).length > 72) return setError('The password is too long (72 bytes at most).')
    setSaving(true)
    try {
      const { data } = await api.post('/auth/users', {
        full_name: form.full_name.trim(), email: form.email.trim(), phone: form.phone.trim() || null, password: form.password, role: form.role,
      })
      toast.success(`${data.full_name} added as ${data.role}`)
      onCreated(data)
    } catch (err) { setError(errorMessage(err, "We couldn't create this account.")) }
    finally { setSaving(false) }
  }

  return (
    <Modal title="Add a user" subtitle="They can sign in straight away with the password you set here." onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="add-user" className="btn-primary flex items-center gap-2" disabled={saving} data-testid="create-user">
            {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Create account
          </button>
        </div>
      )}>
      <form id="add-user" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label" htmlFor="au-name">Full name</label><input id="au-name" className="input" value={form.full_name} onChange={set('full_name')} autoComplete="off" /></div>
          <div><label className="label" htmlFor="au-role">Role</label>
            <select id="au-role" className="input" value={form.role} onChange={set('role')}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label" htmlFor="au-email">Email</label><input id="au-email" type="email" className="input" value={form.email} onChange={set('email')} autoComplete="off" /></div>
          <div><label className="label" htmlFor="au-phone">Phone <span className="text-fg-subtle font-normal">(optional)</span></label><input id="au-phone" className="input" value={form.phone} onChange={set('phone')} autoComplete="off" /></div>
        </div>
        <div>
          <label className="label" htmlFor="au-pass">Temporary password</label>
          <input id="au-pass" type="password" className="input" value={form.password} onChange={set('password')} autoComplete="new-password" aria-describedby="au-hint" />
          <p id="au-hint" className="text-xs text-fg-subtle mt-1">At least 8 characters. Share it with them securely.</p>
        </div>
        {form.role === 'manager' && <p className="p-3 rounded-xl bg-warning-soft text-warning-fg text-sm" data-testid="manager-warning">A Manager can see and administer everything on the platform.</p>}
        {error && <div className="p-3 rounded-xl bg-danger-soft text-danger-fg text-sm" role="alert" data-testid="add-user-error">{error}</div>}
      </form>
    </Modal>
  )
}
