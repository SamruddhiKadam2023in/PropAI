// The API stores some timestamps as naive UTC strings ("2026-09-19T06:12:12.250204" - no offset).
// `new Date()` would read those as *local* time, so they are pinned to UTC here.
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i

export function parseServerDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  const text = String(value)
  const date = new Date(HAS_OFFSET.test(text) ? text : `${text}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDateTime(value) {
  const d = parseServerDate(value)
  return d
    ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''
}

// "YYYY-MM-DD" calendar dates (no time, no zone): read them as that day, never shifted by the viewer's timezone.
export function formatDay(value) {
  if (!value) return ''
  const text = String(value)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : parseServerDate(text)
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
}

export function formatDate(value) {
  const d = parseServerDate(value)
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
}

export function timeAgo(value, now = Date.now()) {
  const d = parseServerDate(value)
  if (!d) return ''
  const seconds = Math.round((now - d.getTime()) / 1000)
  if (seconds < 45) return 'Just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return formatDate(d)
}
