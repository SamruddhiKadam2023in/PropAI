// Money is summed in integer paise so totals never pick up floating-point noise (0.1 + 0.2 = 0.30, not 0.30000000000000004).
export const toCents = (value) => Math.round(Number(value || 0) * 100)
export const sumCents = (values) => values.reduce((sum, v) => sum + toCents(v), 0)
export const fromCents = (cents) => cents / 100

export function formatINR(value) {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '—'
  const n = Number(value)
  const whole = Number.isInteger(n)
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`
}

/** Fee / additional / total of a maintenance record's service block, or null when no service is recorded. */
export function recordMoney(record) {
  const s = record?.service
  if (!s) return null
  return {
    fee: Number(s.service_fee) || 0,
    additional: fromCents(sumCents((s.additional_charges || []).map((c) => c.amount))),
    total: Number(s.total_amount) || 0,
  }
}
