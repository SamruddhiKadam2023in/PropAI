import { useState } from 'react'
import { Eye, EyeOff, KeyRound, Loader2, UserRound } from 'lucide-react'
import toast from 'react-hot-toast'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import { errorMessage } from '../utils/http'

const ROLE_LABEL = { tenant: 'Tenant', owner: 'Property Owner', manager: 'Manager' }
const PHONE_OK = /^[+\d\s().-]+$/

function Notice({ id, message }) {
  return message ? <p id={id} className="p-3 rounded-xl bg-danger-soft text-danger-fg text-sm" role="alert" data-testid={id}>{message}</p> : null
}

function ProfileCard() {
  const { user, updateUser } = useAuth()
  const [name, setName] = useState(user.full_name || '')
  const [phone, setPhone] = useState(user.phone || '')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const dirty = name.trim() !== (user.full_name || '') || phone.trim() !== (user.phone || '')

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    const digits = (phone.match(/\d/g) || []).length
    if (!name.trim()) return setError('Enter your name.')
    if (name.trim().length > 255) return setError('That name is too long.')
    if (phone.trim() && (!PHONE_OK.test(phone.trim()) || digits < 7 || digits > 15 || phone.trim().length > 20)) return setError('Enter a valid phone number (7 to 15 digits; +, spaces, dashes and brackets are fine).')
    setSaving(true)
    try {
      const { data } = await api.patch('/auth/me', { full_name: name.trim(), phone: phone.trim() })
      updateUser(data)
      setName(data.full_name || ''); setPhone(data.phone || '')
      toast.success('Profile saved')
    } catch (err) { setError(errorMessage(err, "We couldn't save your profile.")) }
    finally { setSaving(false) }
  }

  return (
    <section className="card" aria-labelledby="profile-title">
      <h2 id="profile-title" className="section-title flex items-center gap-2 mb-4"><UserRound size={18} aria-hidden="true" /> Profile</h2>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label" htmlFor="ac-name">Full name</label><input id="ac-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} autoComplete="name" data-testid="ac-name" /></div>
          <div><label className="label" htmlFor="ac-phone">Phone <span className="text-fg-subtle font-normal">(optional)</span></label><input id="ac-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} inputMode="tel" autoComplete="tel" data-testid="ac-phone" /></div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label" htmlFor="ac-email">Email</label><input id="ac-email" className="input" value={user.email} readOnly aria-describedby="ac-email-hint" data-testid="ac-email" />
            <p id="ac-email-hint" className="text-xs text-fg-subtle mt-1">Your email is your sign-in and can't be changed here.</p></div>
          <div><label className="label" htmlFor="ac-role">Role</label><input id="ac-role" className="input" value={ROLE_LABEL[user.role] || user.role} readOnly data-testid="ac-role" /></div>
        </div>
        <Notice id="profile-error" message={error} />
        <button type="submit" className="btn-primary flex items-center gap-2" disabled={saving || !dirty} data-testid="save-profile">
          {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Save profile
        </button>
      </form>
    </section>
  )
}

function PasswordCard() {
  const { changePassword } = useAuth()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [show, setShow] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const type = show ? 'text' : 'password'

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!form.current) return setError('Enter your current password.')
    if (form.next.length < 8) return setError('The new password must be at least 8 characters.')
    if (new TextEncoder().encode(form.next).length > 72) return setError('The new password is too long (72 bytes at most).')
    if (form.next === form.current) return setError('Choose a new password that is different from your current one.')
    if (form.next !== form.confirm) return setError("The two new passwords don't match.")
    setSaving(true)
    try {
      await changePassword(form.current, form.next)
      setForm({ current: '', next: '', confirm: '' })
      toast.success('Password changed. Your other devices were signed out.')
    } catch (err) { setError(errorMessage(err, "We couldn't change your password.")) }
    finally { setSaving(false) }
  }

  return (
    <section className="card" aria-labelledby="password-title">
      <h2 id="password-title" className="section-title flex items-center gap-2 mb-1"><KeyRound size={18} aria-hidden="true" /> Password</h2>
      <p className="text-sm text-fg-muted mb-4">Changing your password signs you out on every other device.</p>
      <form onSubmit={submit} noValidate className="space-y-4 max-w-md">
        <div><label className="label" htmlFor="ac-current">Current password</label><input id="ac-current" className="input" type={type} value={form.current} onChange={set('current')} autoComplete="current-password" data-testid="ac-current" /></div>
        <div>
          <label className="label" htmlFor="ac-new">New password</label>
          <div className="relative">
            <input id="ac-new" className="input pr-10" type={type} value={form.next} onChange={set('next')} autoComplete="new-password" aria-describedby="ac-new-hint" data-testid="ac-new" />
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide passwords' : 'Show passwords'} className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p id="ac-new-hint" className="text-xs text-fg-subtle mt-1">At least 8 characters.</p>
        </div>
        <div><label className="label" htmlFor="ac-confirm">Confirm new password</label><input id="ac-confirm" className="input" type={type} value={form.confirm} onChange={set('confirm')} autoComplete="new-password" data-testid="ac-confirm" /></div>
        <Notice id="password-error" message={error} />
        <button type="submit" className="btn-primary flex items-center gap-2" disabled={saving} data-testid="save-password">
          {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Change password
        </button>
      </form>
    </section>
  )
}

/** Account settings, for every role: edit name and phone, change password. */
export default function Account() {
  return (
    <Layout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-fg">Account</h1>
          <p className="text-fg-subtle text-sm mt-0.5">Your profile and sign-in details</p>
        </div>
        <ProfileCard />
        <PasswordCard />
      </div>
    </Layout>
  )
}
