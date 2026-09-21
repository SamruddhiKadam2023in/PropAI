import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../ui/Modal'
import api from '../../services/api'
import { errorMessage } from '../../utils/http'

/** Confirms switching an account off (or back on). Deactivating signs the person out at once and blocks sign-in until reactivated. */
export default function ToggleUserModal({ target, onClose, onDone }) {
  const turningOff = target.is_active
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const confirm = async () => {
    setError(null)
    setSaving(true)
    try {
      await api.patch(`/auth/users/${target.id}/active`, { is_active: !turningOff })
      toast.success(turningOff ? `${target.full_name} was deactivated` : `${target.full_name} was reactivated`)
      onDone()
    } catch (err) { setError(errorMessage(err, "We couldn't update this account.")) }
    finally { setSaving(false) }
  }

  return (
    <Modal title={turningOff ? 'Deactivate this account?' : 'Reactivate this account?'} subtitle={`${target.full_name} · ${target.email}`} onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className={`${turningOff ? 'btn-danger' : 'btn-primary'} flex items-center gap-2`} onClick={confirm} disabled={saving} data-testid="confirm-toggle">
            {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} {turningOff ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      )}>
      <div className="space-y-3 text-sm text-fg-muted">
        {turningOff
          ? <p data-testid="toggle-explainer">They will be signed out immediately and won't be able to sign in until you reactivate them. Their properties, payments and records are not deleted.</p>
          : <p data-testid="toggle-explainer">They will be able to sign in again with their existing password.</p>}
        {error && <div className="p-3 rounded-xl bg-danger-soft text-danger-fg" role="alert" data-testid="toggle-error">{error}</div>}
      </div>
    </Modal>
  )
}
