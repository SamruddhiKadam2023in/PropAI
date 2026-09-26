import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import {
  Building2, LayoutDashboard, FileText, BarChart2, Home,
  LogOut, Menu, X, CreditCard, Users, Sun, Moon, Search, IndianRupee,
  Bell, MessageSquare, CheckCheck, UserCheck, Wrench, ClipboardList, Settings,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { getUnreadCount, listNotifications, markAllNotificationsRead, markNotificationRead } from '../services/notifications'
import { TONE_CLASSES, metaFor } from './notifications/notificationMeta'
import { formatDateTime, timeAgo } from '../utils/dates'

const NAV = {
  tenant: [
    { to: '/tenant',           icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/tenant/documents', icon: FileText,         label: 'My Documents' },
    { to: '/tenant/payments',  icon: CreditCard,       label: 'Payments' },
    { to: '/tenant/analytics', icon: BarChart2,        label: 'Cost Analysis' },
    { to: '/tenant/search',       icon: Search,        label: 'Find a Home' },
    { to: '/tenant/maintenance',  icon: Wrench,        label: 'Maintenance' },
    { to: '/messages',            icon: MessageSquare, label: 'Messages' },
    { to: '/tenant/notifications', icon: Bell,          label: 'Notifications' },
  ],
  owner: [
    { to: '/owner',            icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/owner/properties',   icon: Home,          label: 'Properties' },
    { to: '/owner/applications', icon: Users,         label: 'Applications' },
    { to: '/owner/documents',    icon: FileText,      label: 'Documents' },
    { to: '/owner/analytics',    icon: BarChart2,     label: 'Analytics' },
    { to: '/owner/maintenance',  icon: Wrench,        label: 'Maintenance' },
    { to: '/owner/agreements',   icon: ClipboardList, label: 'Agreements' },
    { to: '/messages',           icon: MessageSquare, label: 'Messages' },
    { to: '/settings/ocr',       icon: Settings,      label: 'OCR Settings' },
  ],
  manager: [
    { to: '/manager',                  icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/manager/users',            icon: Users,           label: 'Users & Roles' },
    { to: '/manager/properties',       icon: Home,            label: 'All Properties' },
    { to: '/manager/applications',     icon: FileText,        label: 'Applications' },
    { to: '/manager/rent-collection',  icon: IndianRupee,     label: 'Rent Collection' },
    { to: '/manager/agreements',       icon: ClipboardList,   label: 'Agreements' },
    { to: '/manager/analytics',        icon: BarChart2,       label: 'Analytics' },
    { to: '/messages',                 icon: MessageSquare,   label: 'Messages' },
    { to: '/settings/ocr',             icon: Settings,        label: 'OCR Settings' },
  ],
}

function NotificationBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const isTenant = user?.role === 'tenant'
  const [open, setOpen] = useState(false)
  const [list, setList] = useState({ status: 'idle', items: [] })
  const [unread, setUnread] = useState(0)
  const ref = useRef(null)

  const refreshCount = useCallback(async () => {
    try { setUnread(await getUnreadCount()) } catch { /* keep the last known count */ }
  }, [])

  const loadList = useCallback(async () => {
    setList((s) => ({ ...s, status: 'loading' }))
    try { setList({ status: 'ready', items: await listNotifications({ limit: 20 }) }) }
    catch { setList((s) => ({ ...s, status: 'error' })) }
  }, [])

  // Live unread badge: every 30s and whenever the tab becomes visible again.
  useEffect(() => {
    refreshCount()
    const timer = setInterval(refreshCount, 30000)
    const onVisible = () => { if (document.visibilityState === 'visible') refreshCount() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [refreshCount])

  // Close on outside click / Escape
  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  }, [])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) { loadList(); refreshCount() }
  }

  const markAll = async () => {
    try {
      await markAllNotificationsRead()
      setList((s) => ({ ...s, items: s.items.map((n) => ({ ...n, read: true })) }))
      setUnread(0)
    } catch { toast.error("Couldn't mark notifications as read.") }
  }

  const openItem = (n) => {
    if (!n.read) {
      setList((s) => ({ ...s, items: s.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)) }))
      setUnread((u) => Math.max(0, u - 1))
      markNotificationRead(n.id).catch(refreshCount)
    }
    const route = isTenant ? metaFor(n.type).route : null   // click-through is a tenant-portal feature
    if (route) { setOpen(false); navigate(route) }
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={toggle} aria-haspopup="true" aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className="flex items-center gap-2.5 px-3 py-2 w-full text-sm text-fg-muted hover:text-accent-text hover:bg-accent-soft rounded-xl transition-colors">
        <Bell size={15} />
        Notifications
        {unread > 0 && (
          <span data-testid="bell-badge" className="ml-auto min-w-[1.25rem] h-5 px-1 bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute bottom-12 left-0 w-80 bg-surface rounded-2xl shadow-2xl border border-line z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <p className="text-sm font-semibold text-fg">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="flex items-center gap-1 text-xs text-accent-text hover:underline">
                <CheckCheck size={12} /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {list.status === 'loading' && list.items.length === 0 && (
              <div className="p-4 space-y-3" aria-busy="true">
                {[0, 1, 2].map((i) => <div key={i} className="h-10 rounded-lg bg-surface-3/70 animate-pulse" />)}
              </div>
            )}
            {list.status === 'error' && (
              <div className="text-center py-8 px-4">
                <p className="text-xs text-danger-fg">We couldn't load your notifications.</p>
                <button type="button" onClick={loadList} className="mt-2 text-xs text-accent-text hover:underline">Try again</button>
              </div>
            )}
            {list.status === 'ready' && list.items.length === 0 && (
              <p className="text-center text-xs text-fg-subtle py-8">No notifications yet</p>
            )}
            {list.items.map((n) => {
              const meta = metaFor(n.type)
              const { Icon } = meta
              return (
                <button key={n.id} type="button" onClick={() => openItem(n)}
                  className={`w-full text-left flex gap-3 px-4 py-3 hover:bg-surface-2 border-b border-line last:border-0 ${!n.read ? 'bg-accent-soft/70' : ''}`}>
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${TONE_CLASSES[meta.tone]}`} aria-hidden="true">
                    <Icon size={15} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-semibold text-fg">{!n.read && <span className="sr-only">Unread: </span>}{n.title}</span>
                    <span className="block text-xs text-fg-muted line-clamp-2">{n.message}</span>
                    <span className="block text-[10px] text-fg-subtle mt-0.5" title={formatDateTime(n.created_at)}>{timeAgo(n.created_at)}</span>
                  </span>
                  {!n.read && <span className="w-2 h-2 bg-accent rounded-full mt-1.5 flex-shrink-0" aria-hidden="true" />}
                </button>
              )
            })}
          </div>

          {isTenant && (
            <Link to="/tenant/notifications" onClick={() => setOpen(false)}
              className="block text-center text-xs font-semibold text-accent-text hover:bg-surface-2 py-2.5 border-t border-line">
              View all notifications
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

const ROLE_STYLE = {
  tenant:  { dot: 'bg-success', badge: 'bg-success-soft text-success-fg', label: 'Tenant' },
  owner:   { dot: 'bg-info',    badge: 'bg-info-soft text-info-fg',       label: 'Owner' },
  manager: { dot: 'bg-violet',  badge: 'bg-violet-soft text-violet-fg',   label: 'Manager' },
}

function Sidebar({ onClose }) {
  const { user, logout } = useAuth()
  const { isDark, toggle: toggleTheme } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const navItems = NAV[user?.role] || []
  const role = ROLE_STYLE[user?.role] || {}

  const handleLogout = () => {
    logout()
    toast.success('Logged out')
    navigate('/login')
  }

  return (
    <div className="flex flex-col h-full w-64 bg-surface border-r border-line">
      {/* Logo */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-line">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 tone-indigo rounded-xl flex items-center justify-center shadow-sm">
            <Building2 size={16} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-fg text-sm">PropAI</p>
            <p className="text-[10px] text-fg-subtle -mt-0.5">Financial Analytics</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 text-fg-subtle hover:text-fg lg:hidden">
            <X size={18} />
          </button>
        )}
      </div>

      {/* Role pill */}
      <div className="px-5 py-3 border-b border-line">
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${role.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${role.dot}`} />
          {role.label} Portal
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ to, icon: Icon, label }) => {
          const EXACT_MATCH = ['/tenant', '/owner', '/manager', '/tenant/search', '/manager/rent-collection', '/messages', '/owner/applications', '/manager/applications', '/tenant/maintenance', '/owner/maintenance']
          const active = location.pathname === to || (!EXACT_MATCH.includes(to) && location.pathname.startsWith(to))
          return (
            <Link key={to} to={to} onClick={onClose}
              className={active ? 'nav-link-active' : 'nav-link'}>
              <Icon size={17} />
              <span>{label}</span>
              {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent" />}
            </Link>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="px-3 py-3 border-t border-line space-y-1">
        <NotificationBell />
        {/* Theme toggle */}
        <button onClick={toggleTheme}
          className="flex items-center gap-2.5 px-3 py-2 w-full text-sm text-fg-muted hover:text-accent-text hover:bg-accent-soft rounded-xl transition-colors">
          {isDark ? <Sun size={15} /> : <Moon size={15} />}
          {isDark ? 'Light Mode' : 'Dark Mode'}
        </button>
        <Link to="/account" onClick={onClose} aria-label="Account settings" data-testid="account-link"
          className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${location.pathname === '/account' ? 'bg-accent-soft' : 'bg-surface-2 hover:bg-accent-soft'}`}>
          <div className="w-8 h-8 tone-indigo rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            {user?.full_name?.[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg truncate">{user?.full_name}</p>
            <p className="text-xs text-fg-subtle truncate">{user?.email}</p>
          </div>
        </Link>
        <button onClick={handleLogout}
          className="flex items-center gap-2.5 px-3 py-2 w-full text-sm text-fg-muted hover:text-danger-fg hover:bg-danger-soft rounded-xl transition-colors">
          <LogOut size={15} />
          Sign Out
        </button>
      </div>
    </div>
  )
}

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { user } = useAuth()

  return (
    <div className="flex h-screen bg-page overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col flex-shrink-0 shadow-sm">
        <Sidebar />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-overlay/50 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside className="relative z-50 shadow-2xl">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile topbar */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-surface border-b border-line shadow-sm">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="p-1 text-fg-muted">
              <Menu size={22} />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 tone-indigo rounded-lg flex items-center justify-center">
                <Building2 size={14} className="text-white" />
              </div>
              <span className="font-bold text-fg text-sm">PropAI</span>
            </div>
          </div>
          <div className="w-7 h-7 tone-indigo rounded-full flex items-center justify-center text-white font-bold text-xs">
            {user?.full_name?.[0]?.toUpperCase()}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-page">
          {children}
        </div>
      </main>
    </div>
  )
}
