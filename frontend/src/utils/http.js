// A readable message from a failed axios request.
export function errorMessage(err, fallback = 'Something went wrong. Please try again.') {
  if (err?.code === 'ECONNABORTED') return 'The request took too long. Please try again.'
  if (!err?.response) return 'Network error. Check your connection and try again.'
  const detail = err.response.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((d) => String(d.msg || '').replace(/^Value error, /, '')).join(' ')
  if (detail && typeof detail.message === 'string') return detail.message
  return fallback
}
