export const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp'
export const MAX_BYTES = 10 * 1024 * 1024
export const MAX_FILES_AT_ONCE = 10

const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const OK_EXT = /\.(pdf|jpe?g|png|webp)$/i

export const DOC_TYPES = {
  electricity_bill: 'Electricity bill',
  water_bill: 'Water bill',
  gas_bill: 'Gas bill',
  rent_receipt: 'Rent receipt',
  invoice: 'Invoice',
  other: 'Other document',
}

export const isActive = (status) => status === 'pending' || status === 'processing'

export const FILTERS = [
  { key: 'all',        label: 'All',          match: () => true },
  { key: 'processing', label: 'Processing',   match: (d) => isActive(d.status) },
  { key: 'completed',  label: 'Completed',    match: (d) => d.status === 'completed' },
  { key: 'review',     label: 'Needs review', match: (d) => d.status === 'flagged' },
  { key: 'failed',     label: 'Failed',       match: (d) => d.status === 'failed' },
]

export function formatBytes(n) {
  if (n == null) return null
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export const formatMoney = (n) =>
  n == null || n === '' ? null : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export const formatDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null

export function validateFile(file) {
  if (!file) return 'No file selected.'
  if (file.size === 0) return 'This file is empty.'
  if (file.size > MAX_BYTES) return `This file is too large (${formatBytes(file.size)}). The maximum size is 10 MB.`
  if (!OK_TYPES.includes(file.type) && !OK_EXT.test(file.name)) {
    return 'Unsupported file type. Please upload a PDF, JPG, PNG or WebP file.'
  }
  return null
}

export { errorMessage } from '../../utils/http'

export function confidenceInfo(score) {
  if (score == null) return null
  const pct = Math.round(score * 100)
  if (score >= 0.8) return { pct, label: 'High', text: 'text-success-fg', bar: 'bg-success' }
  if (score >= 0.65) return { pct, label: 'Good', text: 'text-info-fg', bar: 'bg-info' }
  return { pct, label: 'Low', text: 'text-warning-fg', bar: 'bg-warning' }
}
