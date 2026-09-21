import { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from '../../components/Layout'
import AgreementsManager from '../../components/agreements/AgreementsManager'
import AddUserModal from '../../components/manager/AddUserModal'
import ToggleUserModal from '../../components/manager/ToggleUserModal'
import { useAuth } from '../../contexts/AuthContext'
import api from '../../services/api'
import toast from 'react-hot-toast'
import { MonthlyExpenseBar } from '../../components/Charts'
import { formatDay } from '../../utils/dates'
import {
  Users, Home, BarChart2, Building2, IndianRupee,
  TrendingUp, CheckCircle2, XCircle, Clock, RefreshCw, PieChart,
  AlertTriangle, MapPin, Download, Settings, FileText,
  Cpu, UserCheck, Bell,
} from 'lucide-react'

const fmt = (n) => n?.toLocaleString('en-IN') ?? '—'

// Rent months are "YYYY-MM" strings. These helpers only do string/number arithmetic, so no timezone can shift a month.
const monthLabel = (ym) => {
  const [y, m] = String(ym).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}
const monthsBack = (ym, count) => Array.from({ length: count }, (_, i) => {
  const idx = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1) - i
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
})

// Downloads a generated file. Uses the filename the server chose (it carries the business-timezone date), and reports
// the server's own message when the file could not be generated. Returns true when the download started.
async function downloadBlob(url, filename, mime = 'application/pdf') {
  try {
    const res = await api.get(url, { responseType: 'blob' })
    const named = /filename="?([^";]+)"?/i.exec(res.headers?.['content-disposition'] || '')
    const blobUrl = window.URL.createObjectURL(new Blob([res.data], { type: mime }))
    const a = document.createElement('a')
    a.href = blobUrl; a.download = named?.[1] || filename
    document.body.appendChild(a); a.click(); a.remove()
    window.URL.revokeObjectURL(blobUrl)
    return true
  } catch (err) {
    let message = 'Failed to download report'
    try {
      const detail = JSON.parse(await err?.response?.data?.text?.())?.detail
      if (typeof detail === 'string') message = detail
    } catch { /* the body was not JSON - keep the generic message */ }
    toast.error(message)
    return false
  }
}

function StatCard({ title, value, sub, icon: Icon, iconBg, iconColor }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${iconBg}`}><Icon size={19} className={iconColor} /></div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{title}</p>
        <p className="text-lg sm:text-xl font-bold text-gray-900 mt-0.5 whitespace-nowrap">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function _removed_MLPipelineCard() {
  const components = []
  const colorMap = {}
  return (
    <div className="hidden">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {components.map(({ label, sub, icon: Icon, color }) => {
          const c = colorMap[color]
          return (
            <div key={label} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${c.bg}`}>
                <Icon size={16} className={c.text} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 truncate">{label}</p>
                <p className="text-xs text-gray-400 truncate">{sub}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className={`w-2 h-2 rounded-full ${c.dot} animate-pulse`} />
                <span className="text-xs text-gray-400">Live</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Overview() {
  const [properties, setProperties] = useState([])
  const [users, setUsers]           = useState([])
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/properties/'),
      api.get('/auth/users').catch(() => ({ data: [] })),
    ]).then(([p, u]) => {
      setProperties(p.data)
      setUsers(u.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-400 text-sm">Loading dashboard…</p>
      </div>
    </div>
  )

  const occupied      = properties.filter(p => !p.is_available).length
  const totalRent     = properties.reduce((s, p) => s + (p.rent_amount || 0), 0)
  const occupiedRent  = properties.filter(p => !p.is_available).reduce((s, p) => s + (p.rent_amount || 0), 0)
  const tenants       = users.filter(u => u.role === 'tenant').length
  const owners        = users.filter(u => u.role === 'owner').length

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Manager Dashboard</h1>
        <p className="text-gray-400 text-sm mt-0.5">Full platform administration — PropAI Financial Analytics</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Properties" value={properties.length}
          icon={Building2} iconBg="bg-indigo-50" iconColor="text-indigo-600" />
        <StatCard title="Occupied" value={`${occupied} / ${properties.length}`}
          icon={Home} iconBg="bg-emerald-50" iconColor="text-emerald-600"
          sub={`${properties.length - occupied} available`} />
        <StatCard title="Registered Users" value={users.length || '—'}
          icon={Users} iconBg="bg-violet-50" iconColor="text-violet-600"
          sub={`${tenants} tenants · ${owners} owners`} />
        <StatCard title="Monthly Rent Income" value={`₹${fmt(Math.round(occupiedRent))}`}
          icon={IndianRupee} iconBg="bg-amber-50" iconColor="text-amber-600"
          sub="From occupied properties" />
      </div>

      {/* Rent collection snapshot for current month */}
      <RentSnapshotCard />

      {/* Properties table */}
      <div className="card">
        <h3 className="section-title mb-4">All Properties</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="table-head text-left">Property</th>
                <th className="table-head text-left">Location</th>
                <th className="table-head text-left">Type</th>
                <th className="table-head text-right">Rent / mo</th>
                <th className="table-head text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {properties.map(p => (
                <tr key={p.id} className="table-row">
                  <td className="table-cell font-semibold text-gray-900">{p.title}</td>
                  <td className="table-cell text-gray-400">{p.city}, {p.state}</td>
                  <td className="table-cell capitalize text-gray-500">{p.property_type}</td>
                  <td className="table-cell text-right font-bold text-gray-900">₹{fmt(p.rent_amount)}</td>
                  <td className="table-cell">
                    <span className={p.is_available ? 'badge-green' : 'badge-indigo'}>
                      {p.is_available ? 'Available' : 'Occupied'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Portfolio financials */}
      <div className="grid grid-cols-3 gap-4">
        {[
          ['Total Portfolio Rent', `₹${fmt(totalRent)} / mo`],
          ['Annual Revenue', `₹${fmt(totalRent * 12)}`],
          ['Occupancy Rate', `${properties.length > 0 ? Math.round(occupied / properties.length * 100) : 0}%`],
        ].map(([label, val]) => (
          <div key={label} className="card text-center py-5">
            <p className="text-xs text-gray-400 mb-1">{label}</p>
            <p className="text-xl font-bold text-gray-900">{val}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function UsersPage() {
  const [users, setUsers]     = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding]   = useState(false)
  const [toggling, setToggling] = useState(null)
  const { user: me } = useAuth()

  const load = () => {
    api.get('/auth/users').then(r => { setUsers(r.data); setLoading(false) }).catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const ROLE_BADGE = {
    tenant:  'badge-green',
    owner:   'badge-blue',
    manager: 'badge-purple',
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto" />
    </div>
  )

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users & Roles</h1>
          <p className="text-gray-400 text-sm mt-0.5">All registered platform users</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setAdding(true)} className="btn-primary flex items-center gap-2" data-testid="add-user"><Users size={14} aria-hidden="true" /> Add user</button>
          <button onClick={load} className="btn-secondary flex items-center gap-2">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>
      {adding && <AddUserModal onClose={() => setAdding(false)} onCreated={() => { setAdding(false); load() }} />}
      {toggling && <ToggleUserModal target={toggling} onClose={() => setToggling(null)} onDone={() => { setToggling(null); load() }} />}

      <div className="grid grid-cols-3 gap-4">
        {[['Tenants', users.filter(u=>u.role==='tenant').length, 'badge-green'],
          ['Owners', users.filter(u=>u.role==='owner').length, 'badge-blue'],
          ['Managers', users.filter(u=>u.role==='manager').length, 'badge-purple']
        ].map(([label, count, badge]) => (
          <div key={label} className="card text-center">
            <p className="text-2xl font-bold text-gray-900 mb-1">{count}</p>
            <span className={badge}>{label}</span>
          </div>
        ))}
      </div>

      <div className="card">
        {users.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-8">No users found.</p>
        ) : (
          <div className="overflow-x-auto relative">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-head text-left">Name</th>
                  <th className="table-head text-left">Email</th>
                  <th className="table-head text-left">Role</th>
                  <th className="table-head text-left">Status</th>
                  <th className="table-head text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="table-row" data-testid="user-row" data-email={u.email} data-active={u.is_active ? 'true' : 'false'}>
                    <td className="table-cell">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {u.full_name?.[0]?.toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-900">{u.full_name}</span>
                      </div>
                    </td>
                    <td className="table-cell text-gray-400">{u.email}</td>
                    <td className="table-cell"><span className={ROLE_BADGE[u.role] || 'badge-gray'}>{u.role}</span></td>
                    <td className="table-cell">
                      <span className={u.is_active ? 'badge-green' : 'badge-red'}>
                        {u.is_active ? <><CheckCircle2 size={11} className="mr-1" />Active</> : <><XCircle size={11} className="mr-1" />Inactive</>}
                      </span>
                    </td>
                    <td className="table-cell text-right">
                      {u.id === me?.id
                        ? <span className="text-xs text-gray-500">You</span>
                        : <button onClick={() => setToggling(u)} data-testid="toggle-user" aria-label={`${u.is_active ? 'Deactivate' : 'Reactivate'} ${u.full_name}`}
                            className={`tap text-xs font-medium px-2.5 py-1 rounded-lg border ${u.is_active ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}>
                            {u.is_active ? 'Deactivate' : 'Reactivate'}
                          </button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function PropertiesPage() {
  const [properties, setProperties] = useState([])
  const [analytics, setAnalytics]   = useState({})
  const [exporting, setExporting]   = useState(null)      // 'pdf' | 'excel' | null

  // Exports every property on this page (there is no search or filter here, so "all" and "what you see" are the same).
  const exportAll = async (kind) => {
    setExporting(kind)
    const ok = kind === 'pdf'
      ? await downloadBlob('/reports/properties/pdf', 'properties_report.pdf')
      : await downloadBlob('/reports/properties/excel', 'properties_report.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    if (ok) toast.success(kind === 'pdf' ? 'Property report (PDF) downloaded' : 'Property spreadsheet (Excel) downloaded')
    setExporting(null)
  }

  useEffect(() => {
    api.get('/properties/').then(async r => {
      setProperties(r.data)
      const results = {}
      await Promise.allSettled(r.data.slice(0, 5).map(async p => {
        try {
          const { data } = await api.get(`/analytics/dashboard/${p.id}`)
          results[p.id] = data
        } catch {}
      }))
      setAnalytics(results)
    }).catch(() => {})
  }, [])

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Properties</h1>
          <p className="text-gray-400 text-sm mt-0.5">Platform-wide property management view</p>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Export all properties">
          <button type="button" onClick={() => exportAll('pdf')} disabled={!!exporting} data-testid="export-pdf" className="btn-secondary flex items-center gap-2">
            {exporting === 'pdf' ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />} Download PDF
          </button>
          <button type="button" onClick={() => exportAll('excel')} disabled={!!exporting} data-testid="export-excel" className="btn-secondary flex items-center gap-2">
            {exporting === 'excel' ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />} Download Excel
          </button>
        </div>
      </div>
      {properties.map(p => {
        const ana  = analytics[p.id]
        const trends   = ana?.expense_trends   || {}
        const payments = ana?.payment_history  || []
        const chartData = []
        if (trends.electricity?.values) {
          const months = [...payments].reverse().map(pay => pay.month?.slice(5) || '')
          trends.electricity.values.forEach((_, i) => {
            chartData.push({
              month:       months[i] || `M${i+1}`,
              electricity: trends.electricity.values[i] || 0,
              water:       trends.water?.values?.[i]    || 0,
              gas:         trends.gas?.values?.[i]      || 0,
              internet:    trends.internet?.values?.[i] || 0,
              maintenance: trends.maintenance?.values?.[i] || 0,
            })
          })
        }
        return (
          <div key={p.id} className="card">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-gray-900">{p.title}</h3>
                <div className="flex items-center gap-1.5 text-gray-400 text-xs mt-1">
                  <MapPin size={11} />
                  <span>{p.address}, {p.city}, {p.state}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={p.is_available ? 'badge-green' : 'badge-indigo'}>
                  {p.is_available ? 'Available' : 'Occupied'}
                </span>
                <button onClick={() => downloadBlob(`/reports/financial/${p.id}/pdf`, `report_${p.id}.pdf`)}
                  className="tap flex items-center gap-1 px-2.5 py-1 text-xs text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors font-medium">
                  <Download size={11} /> PDF
                </button>
                <button onClick={() => downloadBlob(`/reports/financial/${p.id}/excel`, `report_${p.id}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
                  className="tap flex items-center gap-1 px-2.5 py-1 text-xs text-emerald-600 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors font-medium">
                  <Download size={11} /> Excel
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="p-3 rounded-xl bg-slate-50 text-center">
                <p className="text-xs text-gray-400">Rent</p>
                <p className="font-bold text-gray-900">₹{fmt(p.rent_amount)}</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 text-center">
                <p className="text-xs text-gray-400">BHK</p>
                <p className="font-bold text-gray-900">{p.bedrooms || '—'}</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 text-center">
                <p className="text-xs text-gray-400">Area</p>
                <p className="font-bold text-gray-900">{p.area_sqft ? `${p.area_sqft} sqft` : '—'}</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 text-center">
                <p className="text-xs text-gray-400">Payments</p>
                <p className="font-bold text-gray-900">{payments.length}</p>
              </div>
            </div>
            {chartData.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Monthly Expense Trend</p>
                <MonthlyExpenseBar data={chartData} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AnalyticsPage() {
  const [properties, setProperties] = useState([])
  const [selected, setSelected]     = useState('')
  const [analytics, setAnalytics]   = useState(null)
  const [market, setMarket]         = useState(null)

  useEffect(() => {
    api.get('/properties/').then(r => {
      setProperties(r.data)
      if (r.data[0]) setSelected(String(r.data[0].id))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selected) return
    Promise.all([
      api.get(`/analytics/dashboard/${selected}`),
      api.get(`/analytics/market-comparison/${selected}`),
    ]).then(([ana, mkt]) => { setAnalytics(ana.data); setMarket(mkt.data) }).catch(() => {})
  }, [selected])

  const payments = analytics?.payment_history || []
  const trends   = analytics?.expense_trends   || {}
  const chartData = []
  if (trends.electricity?.values) {
    const months = [...payments].reverse().map(p => p.month?.slice(5) || '')
    trends.electricity.values.forEach((_, i) => {
      chartData.push({
        month:       months[i] || `M${i+1}`,
        electricity: trends.electricity.values[i] || 0,
        water:       trends.water?.values?.[i]    || 0,
        gas:         trends.gas?.values?.[i]      || 0,
        internet:    trends.internet?.values?.[i] || 0,
        maintenance: trends.maintenance?.values?.[i] || 0,
      })
    })
  }
  const dev    = market?.deviation
  const devPct = dev?.deviation_percent

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-gray-400 text-sm mt-0.5">Platform-wide AI analytics and expense intelligence</p>
        </div>
        {properties.length > 1 && (
          <select className="input w-auto" value={selected} onChange={e => setSelected(e.target.value)}>
            {properties.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        )}
      </div>

      {dev && (
        <div className="card">
          <h3 className="section-title mb-1">KNN Rent Market Analysis</h3>
          <p className="section-subtitle mb-4">Comparing selected property against nearest neighbours</p>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-indigo-50 text-center">
              <p className="text-xs text-indigo-500 font-medium mb-1">Listed Rent</p>
              <p className="text-2xl font-bold text-indigo-700">₹{fmt(dev.tenant_rent)}</p>
            </div>
            <div className="p-4 rounded-xl bg-gray-50 text-center">
              <p className="text-xs text-gray-500 font-medium mb-1">Market Rate (KNN)</p>
              <p className="text-2xl font-bold text-gray-700">₹{fmt(dev.market_rent)}</p>
            </div>
            <div className={`p-4 rounded-xl text-center ${devPct > 5 ? 'bg-red-50' : devPct < -5 ? 'bg-emerald-50' : 'bg-blue-50'}`}>
              <p className="text-xs text-gray-500 font-medium mb-1">Deviation</p>
              <p className={`text-2xl font-bold ${devPct > 5 ? 'text-red-600' : devPct < -5 ? 'text-emerald-600' : 'text-blue-600'}`}>
                {devPct > 0 ? '+' : ''}{devPct?.toFixed(1)}%
              </p>
            </div>
          </div>
        </div>
      )}

      {chartData.length > 0 && (
        <div className="card">
          <h3 className="section-title mb-1">Utility Expense Trend</h3>
          <p className="section-subtitle mb-4">12-month breakdown for selected property</p>
          <MonthlyExpenseBar data={chartData} />
        </div>
      )}

      {analytics?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            ['Avg Monthly Cost', `₹${fmt(Math.round(analytics.summary.avg_monthly_cost || 0))}`],
            ['Peak Month', `₹${fmt(Math.round(analytics.summary.max_monthly_cost || 0))}`],
            ['Lowest Month', `₹${fmt(Math.round(analytics.summary.min_monthly_cost || 0))}`],
            ['Months Tracked', analytics.summary.months_tracked],
          ].map(([label, val]) => (
            <div key={label} className="card text-center">
              <p className="text-xs text-gray-400 mb-1">{label}</p>
              <p className="text-xl font-bold text-gray-900">{val}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RentSnapshotCard() {
  const [data, setData] = useState(null)
  useEffect(() => {
    api.get('/financial/rent-collection').then(r => setData(r.data)).catch(() => {})
  }, [])
  if (!data) return null
  const { summary } = data
  const pct = summary.collection_rate
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="section-title">Rent Collection — {monthLabel(data.month)}</h3>
          <p className="section-subtitle">Monthly payment status across all tenants</p>
        </div>
        <span className={pct >= 80 ? 'badge-green' : pct >= 50 ? 'badge-yellow' : 'badge-red'}>
          {pct}% collected
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Expected',  val: `₹${fmt(Math.round(summary.total_expected))}`,   cls: 'text-gray-900' },
          { label: 'Collected', val: `₹${fmt(Math.round(summary.total_collected))}`,  cls: 'text-emerald-600' },
          { label: 'Paid',      val: `${summary.paid} / ${summary.total}`,             cls: 'text-blue-600' },
          { label: 'Pending',   val: summary.pending,                                  cls: summary.pending > 0 ? 'text-amber-600' : 'text-gray-400' },
        ].map(({ label, val, cls }) => (
          <div key={label} className="text-center p-3 bg-gray-50 rounded-xl min-w-0">
            <p className="text-xs text-gray-400 mb-1">{label}</p>
            <p className={`text-lg font-bold break-words ${cls}`}>{val}</p>
          </div>
        ))}
      </div>
      <div className="progress-bar">
        <div className="progress-fill bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function RentCollectionPage() {
  const [data,    setData]    = useState(null)
  const [month,   setMonth]   = useState('')            // '' = the server's current month
  const [currentMonth, setCurrentMonth] = useState(null)
  const [range,   setRange]   = useState({ from: '', to: '' })
  const [loading, setLoading] = useState(true)
  const [tick,    setTick]    = useState(0)
  const usingRange = !!(range.from || range.to)
  const rangeError = range.from && range.to && range.from > range.to ? "The 'from' date can't be after the 'to' date." : null

  useEffect(() => {
    if (rangeError) return undefined
    let live = true
    setLoading(true)
    const params = usingRange ? { date_from: range.from || undefined, date_to: range.to || undefined } : (month ? { month } : {})
    api.get('/financial/rent-collection', { params })
      .then(r => { if (!live) return; setData(r.data); if (!usingRange && !month) setCurrentMonth(r.data.month); setLoading(false) })
      .catch(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [month, range.from, range.to, rangeError, usingRange, tick])

  const STATUS = {
    completed: { icon: CheckCircle2, cls: 'text-emerald-600', badge: 'badge-green',  label: 'Paid' },
    pending:   { icon: Clock,         cls: 'text-amber-500',  badge: 'badge-yellow', label: 'Pending' },
    overdue:   { icon: AlertTriangle, cls: 'text-red-500',    badge: 'badge-red',    label: 'Overdue' },
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rent Collection</h1>
          <p className="text-gray-400 text-sm mt-0.5">Track monthly rent payments across all tenants</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-40" aria-label="Rent month" value={month || currentMonth || ''} disabled={usingRange || !currentMonth} onChange={e => setMonth(e.target.value)}>
            {currentMonth ? monthsBack(currentMonth, 36).map(m => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            )) : <option value="">Loading…</option>}
          </select>
          <button onClick={() => setTick(t => t + 1)} className="btn-secondary flex items-center gap-2">
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={async () => {
            try {
              const r = await api.post('/financial/send-reminders')
              toast.success(r.data.message)
            } catch { toast.error('Failed to send reminders') }
          }} className="btn-primary flex items-center gap-2">
            <Bell size={14} /> Send Reminders
          </button>
        </div>
      </div>

      <div className="card !p-4 flex flex-wrap items-end gap-3" data-testid="date-filter">
        <div>
          <label className="label" htmlFor="rc-from">Paid from</label>
          <input id="rc-from" type="date" className="input" value={range.from} max={range.to || data?.today} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
        </div>
        <div>
          <label className="label" htmlFor="rc-to">Paid to</label>
          <input id="rc-to" type="date" className="input" value={range.to} min={range.from || undefined} max={data?.today} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
        </div>
        {usingRange && <button type="button" className="btn-secondary" onClick={() => setRange({ from: '', to: '' })} data-testid="clear-dates">Clear dates</button>}
        <p className="text-xs text-fg-muted pb-2.5 flex-1 min-w-[12rem]" data-testid="filter-note">
          {rangeError
            ? <span className="text-danger-fg" role="alert">{rangeError}</span>
            : usingRange
              ? `Showing rent received ${range.from ? `from ${formatDay(range.from)}` : 'up to'} ${range.to ? `${range.from ? 'to ' : ''}${formatDay(range.to)}` : 'today'} (the month selector is off while dates are set).`
              : 'Pick dates to see the rent received on those days, or use the month selector.'}
        </p>
      </div>

      {data?.summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { title: 'Total Expected', value: `₹${fmt(Math.round(data.summary.total_expected))}`,  icon: IndianRupee, bg: 'bg-indigo-50', ic: 'text-indigo-600' },
            { title: 'Collected',      value: `₹${fmt(Math.round(data.summary.total_collected))}`, icon: TrendingUp,  bg: 'bg-emerald-50', ic: 'text-emerald-600' },
            { title: 'Paid / Total',   value: `${data.summary.paid} of ${data.summary.total}`,     icon: CheckCircle2, bg: 'bg-blue-50',    ic: 'text-blue-600' },
            { title: 'Collection Rate',value: `${data.summary.collection_rate}%`,                  icon: PieChart,    bg: 'bg-amber-50',   ic: 'text-amber-600' },
          ].map(({ title, value, icon: Icon, bg, ic }) => (
            <div key={title} className="stat-card">
              <div className={`stat-icon ${bg}`}><Icon size={19} className={ic} /></div>
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{title}</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-head text-left">Property</th>
                  <th className="table-head text-left">City</th>
                  <th className="table-head text-left">Tenant</th>
                  <th className="table-head text-right">Rent</th>
                  <th className="table-head text-center">Status</th>
                  <th className="table-head text-left">Payment Date</th>
                </tr>
              </thead>
              <tbody>
                {(data?.collection || []).map((row, i) => {
                  const s = STATUS[row.status] || STATUS.pending
                  const StatusIcon = s.icon
                  return (
                    <tr key={i} className="table-row">
                      <td className="table-cell font-semibold text-gray-900">
                        {row.property_title}<br />
                        <span className="font-normal text-gray-400">{row.bedrooms}BHK</span>
                      </td>
                      <td className="table-cell text-gray-500">{row.city}</td>
                      <td className="table-cell">
                        <p className="font-medium text-gray-800">{row.tenant_name}</p>
                        <p className="text-xs text-gray-400">{row.tenant_email}</p>
                      </td>
                      <td className="table-cell text-right font-bold text-gray-900">₹{fmt(row.rent_amount)}</td>
                      <td className="table-cell text-center">
                        <span className={s.badge}>{s.label}</span>
                      </td>
                      <td className="table-cell text-gray-400 text-xs">
                        {row.payment_date
                          ? formatDay(row.payment_date)
                          : <span className="text-amber-500 flex items-center gap-1"><Clock size={11} /> Awaiting</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function SettingsPage() {
  const INFO = [
    { label: 'OCR Engine',      value: 'Tesseract 5.x (pytesseract)',        desc: 'Text extraction from utility bill images' },
    { label: 'Image Pipeline',  value: 'OpenCV headless + Pillow',           desc: 'Grayscale → denoise → threshold preprocessing' },
    { label: 'NLP Framework',   value: 'spaCy 3.7.2 · en_core_web_sm',      desc: 'Named entity recognition: amounts, dates, vendors' },
    { label: 'ML Algorithms',   value: 'KNN (scikit-learn) + Linear Regression', desc: 'Rent estimation + expense forecasting' },
    { label: 'Database',        value: 'PostgreSQL 15 + MongoDB 6',          desc: 'Relational data + document analytics logs' },
    { label: 'Authentication',  value: 'JWT (PyJWT 2.8) + bcrypt 4.0.1',    desc: 'Role-based access: tenant / owner / manager' },
    { label: 'Backend',         value: 'FastAPI 0.104 + async SQLAlchemy 2', desc: 'REST API with async I/O' },
    { label: 'Frontend',        value: 'React 18 + Vite + Tailwind CSS',     desc: 'Recharts + TanStack Query' },
    { label: 'Containerisation',value: 'Docker Compose (5 services)',        desc: 'postgres, mongodb, redis, backend, frontend' },
  ]
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">System Configuration</h1>
        <p className="text-gray-400 text-sm mt-0.5">Platform technology stack and AI pipeline details</p>
      </div>
      <div className="card">
        <div className="flex items-center gap-2 mb-5">
          <Settings size={18} className="text-indigo-600" />
          <h3 className="section-title">Tech Stack</h3>
        </div>
        <div className="space-y-3">
          {INFO.map(({ label, value, desc }) => (
            <div key={label} className="flex items-start gap-4 p-3 rounded-xl bg-gray-50 border border-gray-100">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
                <p className="text-sm font-bold text-gray-900 mt-0.5">{value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
              </div>
              <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0 mt-1" />
            </div>
          ))}
        </div>
      </div>
      <div className="card border-2 border-indigo-100 bg-indigo-50/30">
        <div className="flex items-start gap-3">
          <ShieldCheck size={22} className="text-indigo-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-gray-900">Project Details</h4>
            <p className="text-sm text-gray-600 mt-1">
              AI-Driven Financial Analytics for Property Management
            </p>
            <p className="text-xs text-gray-400 mt-1">
              MES Pillai College of Engineering · ECS Department<br />
              Guided by Prof. Padmaja Bangde
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function RentalApplicationsPage() {
  const [apps, setApps]       = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/properties/all-applications')
      setApps(r.data)
    } catch { toast.error('Failed to load applications') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const approve = async (id) => {
    try {
      await api.patch(`/properties/applications/${id}/approve`)
      toast.success('Application approved — tenant assigned!')
      load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to approve') }
  }

  const reject = async (id) => {
    try {
      await api.patch(`/properties/applications/${id}/reject`)
      toast.success('Application rejected')
      load()
    } catch { toast.error('Failed to reject') }
  }

  const STATUS = {
    pending:  { cls: 'badge-yellow', label: 'Pending' },
    approved: { cls: 'badge-green',  label: 'Approved' },
    rejected: { cls: 'badge-red',    label: 'Rejected' },
    enquiry:  { cls: 'badge-blue',   label: 'Enquiry' },
  }

  const pending  = apps.filter(a => a.status === 'pending')
  const resolved = apps.filter(a => a.status !== 'pending')

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Rental Applications</h1>
          <p className="text-gray-400 text-sm mt-0.5">Review and approve all tenant rental applications</p>
        </div>
        <button onClick={load} className="btn-ghost flex items-center gap-2 text-sm">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total', value: apps.length, color: 'text-gray-900 dark:text-white' },
          { label: 'Pending', value: pending.length, color: 'text-amber-600' },
          { label: 'Approved', value: apps.filter(a => a.status === 'approved').length, color: 'text-emerald-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center py-4">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      ) : apps.length === 0 ? (
        <div className="card text-center py-16">
          <UserCheck size={40} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No applications yet</p>
          <p className="text-gray-400 text-sm mt-1">Applications from tenants will appear here</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Pending Review ({pending.length})</h2>
              <div className="space-y-3">
                {pending.map(app => (
                  <div key={app._id} className="card border-l-4 border-amber-400 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-white">{app.property_title}</p>
                      <p className="text-xs text-gray-400 mb-2">{app.property_address}, {app.property_city}</p>
                      <div className="flex flex-wrap gap-4 text-sm">
                        <div>
                          <p className="text-xs text-gray-400">Tenant</p>
                          <p className="font-medium text-gray-800 dark:text-gray-200">{app.tenant_name}</p>
                          <p className="text-xs text-gray-400">{app.tenant_email}</p>
                          {app.tenant_phone && <p className="text-xs text-gray-400">{app.tenant_phone}</p>}
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Rent</p>
                          <p className="font-bold text-indigo-600">₹{Number(app.rent_amount).toLocaleString('en-IN')}/mo</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Applied</p>
                          <p className="text-gray-700 dark:text-gray-300">{new Date(app.applied_at).toLocaleDateString('en-IN')}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => reject(app._id)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 transition-colors">
                        <XCircle size={14} /> Reject
                      </button>
                      <button onClick={() => approve(app._id)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors">
                        <CheckCircle2 size={14} /> Approve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {resolved.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Resolved ({resolved.length})</h2>
              <div className="space-y-2">
                {resolved.map(app => {
                  const s = STATUS[app.status] || STATUS.pending
                  return (
                    <div key={app._id} className="card flex items-center gap-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-800 dark:text-gray-200 text-sm">{app.property_title}</p>
                        <p className="text-xs text-gray-400">{app.tenant_name} · {app.tenant_email}</p>
                      </div>
                      <p className="text-sm font-bold text-gray-700 dark:text-gray-300">₹{Number(app.rent_amount).toLocaleString('en-IN')}/mo</p>
                      <span className={s.cls}>{s.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ManagerDashboard() {
  return (
    <Layout>
      <Routes>
        <Route index                  element={<Overview />} />
        <Route path="users"           element={<UsersPage />} />
        <Route path="properties"      element={<PropertiesPage />} />
        <Route path="applications"    element={<RentalApplicationsPage />} />
        <Route path="analytics"       element={<AnalyticsPage />} />
        <Route path="rent-collection" element={<RentCollectionPage />} />
        <Route path="agreements"      element={<AgreementsManager />} />
      </Routes>
    </Layout>
  )
}
