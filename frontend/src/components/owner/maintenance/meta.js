export const STATUS = {
  open:        { label: 'Open',        cls: 'badge-yellow' },
  in_progress: { label: 'In progress', cls: 'badge-blue' },
  resolved:    { label: 'Resolved',    cls: 'badge-green' },
}
export const URGENCY = {
  low:    { label: 'Low',    cls: 'badge-blue' },
  medium: { label: 'Medium', cls: 'badge-yellow' },
  high:   { label: 'High',   cls: 'badge-red' },
}
export const PAYMENT = {
  paid:    { label: 'Paid',            cls: 'badge-green' },
  pending: { label: 'Payment pending', cls: 'badge-yellow' },
}
export const CATEGORY_LABEL = {
  plumbing: 'Plumbing', electrical: 'Electrical', appliance: 'Appliance', furniture: 'Furniture & fittings',
  pest_control: 'Pest control', cleaning: 'Cleaning', structural: 'Structural & painting', other: 'Other',
}
export const PROVIDER_TYPE_LABEL = {
  independent: 'Independent contractor', authorized_center: 'Authorized service centre', agency: 'Licensed agency', other: 'Other',
}
export const SERVICE_TYPE_SUGGESTIONS = [
  'Leaking tap repair', 'Drain clearing', 'Split AC servicing', 'Geyser repair', 'Ceiling fan repair', 'Switchboard repair',
  'Pest control', 'Deep cleaning', 'Waterproofing', 'Repainting', 'Carpentry repair', 'Lock replacement',
]

export const statusOf = (s) => STATUS[s] || { label: s || 'Unknown', cls: 'badge-gray' }
export const urgencyOf = (u) => URGENCY[u] || { label: u || '—', cls: 'badge-gray' }

// The date a record is "about": when the service is/was scheduled, else when it was raised.
export const serviceDate = (r) => r.service?.scheduled_date || (r.created_at || '').slice(0, 10)

export const raisedBy = (r) => (r.source === 'tenant' && r.tenant_name ? `Raised by ${r.tenant_name}` : r.source === 'owner' ? 'Logged by owner' : r.tenant_name ? `Raised by ${r.tenant_name}` : 'Tenant request')
