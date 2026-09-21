import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States'
import { TONE_CLASSES, metaFor } from '../../components/notifications/notificationMeta'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../../services/notifications'
import { formatDateTime, timeAgo } from '../../utils/dates'
import { errorMessage } from '../../utils/http'

const PAGE_SIZE = 50
const REFRESH_MS = 60000

const FILTERS = [
  { key: 'all',         label: 'All',         match: () => true },
  { key: 'unread',      label: 'Unread',      match: (n) => !n.read },
  { key: 'payments',    label: 'Payments',    match: (n) => metaFor(n.type).group === 'payments' },
  { key: 'maintenance', label: 'Maintenance', match: (n) => metaFor(n.type).group === 'maintenance' },
  { key: 'property',    label: 'Property',    match: (n) => metaFor(n.type).group === 'property' },
]

// Keep already-loaded pages, add anything newer, and take the fresh read/unread state from the server.
function mergeLatest(current, latest) {
  const fresh = new Map(latest.map((n) => [n.id, n]))
  const known = new Set(current.map((n) => n.id))
  return [...latest.filter((n) => !known.has(n.id)), ...current.map((n) => fresh.get(n.id) || n)]
}

function NotificationRow({ notification: n, onOpen }) {
  const meta = metaFor(n.type)
  const { Icon } = meta
  return (
    <li>
      <button type="button" onClick={() => onOpen(n)} data-testid="notification-row" data-read={n.read ? 'true' : 'false'}
        className={`w-full text-left flex gap-3 p-4 transition-colors hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2 ${
          n.read ? '' : 'bg-accent-soft/50'}`}>
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${TONE_CLASSES[meta.tone]}`} aria-hidden="true">
          <Icon size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-3">
            <span className={`text-sm text-fg break-words ${n.read ? 'font-medium' : 'font-bold'}`}>
              {!n.read && <span className="sr-only">Unread: </span>}{n.title}
            </span>
            {!n.read && <span className="w-2.5 h-2.5 rounded-full bg-accent flex-shrink-0 mt-1.5" aria-hidden="true" />}
          </span>
          <span className="block text-sm text-fg-muted mt-0.5 break-words">{n.message}</span>
          <span className="flex flex-wrap items-center gap-2 mt-2 text-xs text-fg-subtle">
            <span className="badge-gray">{meta.label}</span>
            <time dateTime={n.created_at} title={formatDateTime(n.created_at)}>{timeAgo(n.created_at)} · {formatDateTime(n.created_at)}</time>
          </span>
        </span>
      </button>
    </li>
  )
}

export default function TenantNotifications() {
  const navigate = useNavigate()
  const [state, setState] = useState({ status: 'loading', items: [], error: null, hasMore: false })
  const [filter, setFilter] = useState('all')
  const [loadingMore, setLoadingMore] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }))
    try {
      const items = await listNotifications({ limit: PAGE_SIZE })
      setState({ status: 'ready', items, error: null, hasMore: items.length === PAGE_SIZE })
    } catch (err) {
      setState({ status: 'error', items: [], error: errorMessage(err, "We couldn't load your notifications."), hasMore: false })
    }
  }, [])

  const refreshQuietly = useCallback(async () => {
    try {
      const latest = await listNotifications({ limit: PAGE_SIZE })
      setState((s) => (s.status === 'ready' ? { ...s, items: mergeLatest(s.items, latest) } : s))
    } catch { /* keep what we have */ }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const timer = setInterval(refreshQuietly, REFRESH_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') refreshQuietly() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [refreshQuietly])

  const setRead = (ids, read) =>
    setState((s) => ({ ...s, items: s.items.map((n) => (ids.includes(n.id) ? { ...n, read } : n)) }))

  const open = async (n) => {
    if (!n.read) {
      setRead([n.id], true)
      markNotificationRead(n.id).catch(() => { setRead([n.id], false); toast.error("Couldn't mark that notification as read.") })
    }
    const { route } = metaFor(n.type)
    if (route) navigate(route)
  }

  const markAll = async () => {
    const ids = state.items.filter((n) => !n.read).map((n) => n.id)
    if (!ids.length) return
    setMarkingAll(true)
    setRead(ids, true)
    try {
      await markAllNotificationsRead()
      toast.success('All notifications marked as read')
    } catch (err) {
      setRead(ids, false)
      toast.error(errorMessage(err, "Couldn't mark notifications as read."))
    } finally {
      setMarkingAll(false)
    }
  }

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const more = await listNotifications({ limit: PAGE_SIZE, skip: state.items.length })
      setState((s) => ({ ...s, items: [...s.items, ...more.filter((m) => !s.items.some((n) => n.id === m.id))], hasMore: more.length === PAGE_SIZE }))
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load more notifications."))
    } finally {
      setLoadingMore(false)
    }
  }

  const unread = state.items.filter((n) => !n.read).length
  const active = FILTERS.find((f) => f.key === filter) || FILTERS[0]
  const visible = state.items.filter(active.match)

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg">Notifications</h1>
          <p className="text-sm text-fg-subtle mt-1" aria-live="polite">
            {state.status === 'ready' ? (unread > 0 ? `You have ${unread} unread notification${unread === 1 ? '' : 's'}.` : "You're all caught up.") : 'Payment reminders, maintenance updates and news about your home.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost flex items-center gap-1.5" onClick={load} disabled={state.status === 'loading'}>
            <RefreshCw size={14} className={state.status === 'loading' ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
          </button>
          <button type="button" className="btn-secondary flex items-center gap-1.5" onClick={markAll} disabled={unread === 0 || markingAll}>
            <CheckCheck size={15} aria-hidden="true" /> Mark all as read
          </button>
        </div>
      </div>

      {state.status === 'loading' && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading notifications">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      )}

      {state.status === 'error' && <ErrorState title="We couldn't load your notifications" description={state.error} onRetry={load} />}

      {state.status === 'ready' && state.items.length === 0 && (
        <EmptyState icon={Bell} title="No notifications yet"
          description="Rent reminders, payment confirmations, maintenance updates and news about your home will show up here." />
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter notifications">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  filter === f.key ? 'bg-accent text-accent-on' : 'bg-surface-2 text-fg-muted hover:text-fg'}`}>
                {f.label} <span className="opacity-80">({state.items.filter(f.match).length})</span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-fg-subtle text-center py-8">No notifications in this view.</p>
          ) : (
            <ul className="card !p-0 overflow-hidden divide-y divide-line" aria-label="Notifications">
              {visible.map((n) => <NotificationRow key={n.id} notification={n} onOpen={open} />)}
            </ul>
          )}

          {state.hasMore && (
            <div className="text-center">
              <button type="button" className="btn-secondary" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load older notifications'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
