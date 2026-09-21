// Keys match the backend (schemas/financial.py PAYMENT_TYPES).
export const PAYMENT_TYPES = [
  { value: 'rent', label: 'Rent' },
  { value: 'security_deposit', label: 'Security deposit' },
  { value: 'maintenance', label: 'Maintenance charge' },
  { value: 'utility', label: 'Utility bill' },
  { value: 'late_fee', label: 'Late fee' },
  { value: 'other', label: 'Other' },
]
export const typeLabel = (value) => PAYMENT_TYPES.find((t) => t.value === value)?.label || 'Other'

export const TXN_STATUS = {
  completed: { label: 'Completed', cls: 'badge-green' },
  pending: { label: 'Pending', cls: 'badge-yellow' },
  failed: { label: 'Failed', cls: 'badge-red' },
}
export const txnStatus = (s) => TXN_STATUS[s] || { label: s || 'Unknown', cls: 'badge-gray' }

export const PERIOD_STATUS = {
  paid: { label: 'Paid', cls: 'badge-green' },
  partial: { label: 'Partially paid', cls: 'badge-yellow' },
  unpaid: { label: 'Due', cls: 'badge-yellow' },
}

// "2026-09" -> "Sep 2026". Pure arithmetic on the string, so no timezone can shift the month.
export const monthLabel = (ym) => {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) return ''
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}
export const monthLong = (ym) => {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) return ''
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
