import { useState, useEffect, useCallback, useRef } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import Layout from '../../components/Layout'
import TenantDocuments from './Documents'
import TenantMaintenance from './Maintenance'
import TenantPayments from './Payments'
import TenantNotifications from './Notifications'
import PropertySearch from './PropertySearch'
import PropertyPanel from '../../components/tenant/PropertyPanel'
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States'
import { LivingCostPie, MonthlyExpenseBar } from '../../components/Charts'
import { SERIES, seriesTint } from '../../theme/palette'
import { useAuth } from '../../contexts/AuthContext'
import api from '../../services/api'
import { getDashboardAnalytics, listMyProperties } from '../../services/properties'
import { errorMessage } from '../../utils/http'
import toast from 'react-hot-toast'
import {
  Home, TrendingUp, TrendingDown, Minus,
  Download, Wifi, Zap, Droplets,
  Flame, Wrench, CheckCircle2, Clock, AlertCircle, IndianRupee,
} from 'lucide-react'

const fmt = (n) => n?.toLocaleString('en-IN') ?? '—'

const UTIL_KEYS = ['electricity', 'water', 'gas', 'internet', 'maintenance']

async function downloadBlobPDF(url, filename) {
  try {
    const res = await api.get(url, { responseType: 'blob' })
    const blobUrl = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(blobUrl)
  } catch {
    toast.error('Failed to download PDF')
  }
}

const CATEGORY_META = {
  electricity: { label: 'Electricity', icon: Zap,      color: SERIES.electricity },
  water:       { label: 'Water',       icon: Droplets,  color: SERIES.water },
  gas:         { label: 'Gas',         icon: Flame,     color: SERIES.gas },
  internet:    { label: 'Internet',    icon: Wifi,      color: SERIES.internet },
  maintenance: { label: 'Maintenance', icon: Wrench,    color: SERIES.maintenance },
}

function StatCard({ title, value, sub, icon: Icon, tone, trend }) {
  return (
    <div className={`rounded-2xl p-5 shadow-md ${tone}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
          <Icon size={18} />
        </div>
        {trend !== undefined && (
          <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full font-medium">
            {trend > 0 ? `+${trend}%` : trend < 0 ? `${trend}%` : 'Stable'}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm text-white/90 mt-0.5">{title}</p>
      {sub && <p className="text-xs text-white/90 mt-1">{sub}</p>}
    </div>
  )
}

function PaymentBadge({ status }) {
  if (status === 'completed') return <span className="badge-green"><CheckCircle2 size={11} className="mr-1" />Paid</span>
  if (status === 'pending')   return <span className="badge-yellow"><Clock size={11} className="mr-1" />Pending</span>
  return <span className="badge-red"><AlertCircle size={11} className="mr-1" />{status}</span>
}

function CostOverview({ property, analytics }) {
  const forecast    = analytics?.forecast_next_month || {}
  const trends       = analytics?.expense_trends || {}
  const currentCost  = analytics?.current_living_cost || {}
  const payments     = analytics?.payment_history || []
  const summary      = analytics?.summary || {}

  // Build chart data from trends
  const chartData = []
  const months = [...(payments || [])].reverse().map(p => p.month?.slice(5) || '')
  if (trends.electricity?.values) {
    trends.electricity.values.forEach((_, i) => {
      chartData.push({
        month: months[i] || `M${i+1}`,
        electricity: trends.electricity.values[i] || 0,
        water:       trends.water?.values?.[i]       || 0,
        gas:         trends.gas?.values?.[i]         || 0,
        internet:    trends.internet?.values?.[i]    || 0,
        maintenance: trends.maintenance?.values?.[i] || 0,
      })
    })
  }

  const pieData = Object.entries(CATEGORY_META).map(([key, meta]) => ({
    name: meta.label,
    value: currentCost[key] || 0,
    fill: meta.color,
  })).filter(d => d.value > 0)

  // Sum only utility categories (exclude 'total', 'month', 'rent' keys to avoid double-count / NaN)
  const totalMonthly = UTIL_KEYS.reduce((sum, k) => sum + (currentCost[k] || 0), 0)
  const lastPayment  = payments[0]

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Monthly Rent"    value={`₹${fmt(property?.rent_amount)}`}
          icon={Home}        tone="tone-indigo" />
        <StatCard title="Utility Expenses" value={`₹${fmt(Math.round(totalMonthly))}`}
          icon={TrendingUp}  tone="tone-amber"
          sub="This month" />
        <StatCard title="Total Living Cost" value={`₹${fmt(Math.round((property?.rent_amount || 0) + totalMonthly))}`}
          icon={IndianRupee} tone="tone-emerald" />
        <StatCard title="Rent Payments" value={`${payments.filter(p=>p.status==='completed').length} / ${payments.length}`}
          icon={CheckCircle2} tone="tone-violet"
          sub="Completed" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="card lg:col-span-3">
          <h3 className="section-title mb-1">Monthly Expense Trend</h3>
          <p className="section-subtitle mb-4">Utility bills across 12 months (₹)</p>
          <MonthlyExpenseBar data={chartData} />
        </div>
        <div className="card lg:col-span-2">
          <h3 className="section-title mb-1">Cost Breakdown</h3>
          <p className="section-subtitle mb-4">Current month distribution</p>
          <LivingCostPie data={pieData} />
        </div>
      </div>

      {/* Category breakdown */}
      <div className="card">
        <h3 className="section-title mb-4">Utility Bill Details</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Object.entries(CATEGORY_META).map(([key, { label, icon: Icon, color }]) => {
            const amount  = currentCost[key] || 0
            const tdir    = trends[key]?.direction
            return (
              <div key={key} className="p-3 rounded-xl border border-line bg-surface-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: seriesTint(key) }}>
                    <Icon size={14} style={{ color }} />
                  </div>
                  {tdir === 'increasing' && <TrendingUp  size={13} className="text-danger-fg" />}
                  {tdir === 'decreasing' && <TrendingDown size={13} className="text-success-fg" />}
                  {tdir === 'stable'     && <Minus        size={13} className="text-fg-subtle" />}
                </div>
                <p className="text-sm font-bold text-fg">₹{fmt(amount)}</p>
                <p className="text-xs text-fg-subtle">{label}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Forecast */}
      {Object.keys(forecast).length > 0 && (
        <div className="card">
          <h3 className="section-title mb-1">Next Month Forecast</h3>
          <p className="section-subtitle mb-4">AI-predicted expenses using Linear Regression</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {Object.entries(CATEGORY_META).map(([key, { label, icon: Icon, color }]) => {
              const predicted = forecast[key]
              const current   = currentCost[key] || 0
              const delta     = predicted && current ? ((predicted - current) / current * 100).toFixed(1) : null
              if (!predicted) return null
              return (
                <div key={key} className="p-3 rounded-xl border border-dashed border-line">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Icon size={13} style={{ color }} />
                    <span className="text-xs text-fg-muted">{label}</span>
                  </div>
                  <p className="text-base font-bold text-fg">₹{fmt(Math.round(predicted))}</p>
                  {delta !== null && (
                    <p className={`text-xs font-medium mt-0.5 ${parseFloat(delta) > 0 ? 'text-danger-fg' : 'text-success-fg'}`}>
                      {parseFloat(delta) > 0 ? `+${delta}%` : `${delta}%`} vs current
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Payment history */}
      {payments.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="section-title">Rent Payment History</h3>
              <p className="section-subtitle">All monthly rent transactions</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="table-head text-left">Month</th>
                  <th className="table-head text-left">Date</th>
                  <th className="table-head text-right">Amount</th>
                  <th className="table-head text-left">Status</th>
                  <th className="table-head text-right">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {payments.slice(0, 12).map(p => (
                  <tr key={p.id} className="table-row">
                    <td className="table-cell font-medium">{p.month}</td>
                    <td className="table-cell text-fg-subtle">{p.payment_date}</td>
                    <td className="table-cell text-right font-bold text-fg">₹{fmt(p.amount)}</td>
                    <td className="table-cell"><PaymentBadge status={p.status} /></td>
                    <td className="table-cell text-right">
                      <button
                        onClick={() => downloadBlobPDF(`/reports/receipt/${p.id}/pdf`, `receipt_${p.month}.pdf`)}
                        className="text-accent-text hover:text-accent transition-colors"
                        title="Download PDF receipt">
                        <Download size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

const greeting = () => {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

function HomeSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading your home">
      <Skeleton className="h-72" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}
      </div>
      <Skeleton className="h-72" />
    </div>
  )
}

function Overview() {
  const { user } = useAuth()
  const [state, setState] = useState({ status: 'loading', properties: [], error: null })
  const [selectedId, setSelectedId] = useState(null)
  const [analytics, setAnalytics] = useState({ status: 'idle', data: null })
  const latestAnalytics = useRef(null)

  const loadProperties = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }))
    try {
      const properties = await listMyProperties()
      setState({ status: 'ready', properties, error: null })
      setSelectedId((cur) => (properties.some((p) => p.id === cur) ? cur : properties[0]?.id ?? null))
    } catch (err) {
      setState({ status: 'error', properties: [], error: errorMessage(err, "We couldn't load your property.") })
    }
  }, [])

  const loadAnalytics = useCallback(async (id) => {
    latestAnalytics.current = id
    setAnalytics({ status: 'loading', data: null })
    try {
      const data = await getDashboardAnalytics(id)
      if (latestAnalytics.current === id) setAnalytics({ status: 'ready', data })
    } catch {
      if (latestAnalytics.current === id) setAnalytics({ status: 'error', data: null })
    }
  }, [])

  useEffect(() => { loadProperties() }, [loadProperties])
  useEffect(() => { if (selectedId != null) loadAnalytics(selectedId) }, [selectedId, loadAnalytics])

  const property = state.properties.find((p) => p.id === selectedId)
  const firstName = user?.full_name?.split(' ')[0]

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-fg">{greeting()}, {firstName} 👋</h1>
        <p className="text-fg-subtle text-sm mt-0.5">
          {property ? `Everything about ${property.title}, in one place.` : 'Welcome to your tenant home.'}
        </p>
      </div>

      {state.status === 'loading' && <HomeSkeleton />}

      {state.status === 'error' && (
        <ErrorState title="We couldn't load your property" description={state.error} onRetry={loadProperties} />
      )}

      {state.status === 'ready' && state.properties.length === 0 && (
        <EmptyState
          icon={Home}
          title="No property is linked to your account yet"
          description="Once an owner approves your rental application, your home and its details will appear here. Meanwhile you can browse available homes and track your applications."
          action={<Link to="/tenant/search" className="btn-primary">Find a home</Link>}
        />
      )}

      {state.status === 'ready' && property && (
        <>
          {state.properties.length > 1 && (
            <div>
              <label className="label" htmlFor="home-property">Property</label>
              <select id="home-property" className="input w-auto" value={selectedId ?? ''} onChange={(e) => setSelectedId(Number(e.target.value))}>
                {state.properties.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
          )}

          <PropertyPanel key={property.id} property={property} />

          {analytics.status === 'loading' && <Skeleton className="h-72" />}
          {analytics.status === 'error' && (
            <ErrorState compact title="We couldn't load your cost analytics" description="Your property details are shown above."
              onRetry={() => loadAnalytics(property.id)} />
          )}
          {analytics.status === 'ready' && <CostOverview property={property} analytics={analytics.data} />}
        </>
      )}
    </div>
  )
}

function AnalyticsPage() {
  const [properties, setProperties] = useState([])
  const [analytics, setAnalytics]   = useState(null)
  const [market, setMarket]         = useState(null)

  useEffect(() => {
    api.get('/properties/').then(async r => {
      setProperties(r.data)
      if (r.data[0]) {
        const [ana, mkt] = await Promise.all([
          api.get(`/analytics/dashboard/${r.data[0].id}`),
          api.get(`/analytics/market-comparison/${r.data[0].id}`),
        ])
        setAnalytics(ana.data)
        setMarket(mkt.data)
      }
    }).catch(() => {})
  }, [])

  const dev = market?.deviation
  const devPct = dev?.deviation_percent
  const devColor = devPct > 5 ? 'text-danger-fg' : devPct < -5 ? 'text-success-fg' : 'text-fg-muted'

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-fg">Cost Analysis</h1>
        <p className="text-fg-subtle text-sm mt-0.5">AI-powered rent and expense intelligence</p>
      </div>

      {/* Rent comparison */}
      {dev && (
        <div className="card">
          <h3 className="section-title mb-1">KNN Rent Market Comparison</h3>
          <p className="section-subtitle mb-5">Your rent vs similar properties in the market (K-Nearest Neighbors)</p>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="p-4 rounded-xl bg-accent-soft text-center">
              <p className="text-xs text-accent-text font-medium mb-1">Your Rent</p>
              <p className="text-2xl font-bold text-accent-text">₹{fmt(dev.tenant_rent)}</p>
            </div>
            <div className="p-4 rounded-xl bg-surface-2 text-center">
              <p className="text-xs text-fg-muted font-medium mb-1">Market Rate</p>
              <p className="text-2xl font-bold text-fg">₹{fmt(dev.market_rent)}</p>
            </div>
            <div className={`p-4 rounded-xl text-center ${devPct > 5 ? 'bg-danger-soft' : devPct < -5 ? 'bg-success-soft' : 'bg-surface-2'}`}>
              <p className="text-xs text-fg-muted font-medium mb-1">Deviation</p>
              <p className={`text-2xl font-bold ${devColor}`}>{devPct > 0 ? '+' : ''}{devPct?.toFixed(1)}%</p>
            </div>
          </div>
          <div className={`p-3 rounded-xl text-sm font-medium ${devPct > 5 ? 'bg-danger-soft text-danger-fg' : devPct < -5 ? 'bg-success-soft text-success-fg' : 'bg-info-soft text-info-fg'}`}>
            {devPct > 5 ? '⚠ Your rent is above market rate. Consider negotiating with your landlord.'
              : devPct < -5 ? '✓ You are paying below market rate — great deal!'
              : '✓ Your rent is aligned with the current market rate.'}
          </div>
          {market.similar_properties?.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-fg mb-3">Similar Properties Used for Comparison</p>
              <div className="space-y-2">
                {market.similar_properties.slice(0, 4).map((p, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-surface-2 text-sm">
                    <div>
                      <p className="font-medium text-fg">{p.title}</p>
                      <p className="text-xs text-fg-subtle">{p.city} · {p.bedrooms}BHK · {p.area_sqft} sqft</p>
                    </div>
                    <p className="font-bold text-fg">₹{fmt(p.rent_amount)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary stats */}
      {analytics?.summary && (
        <div className="card">
          <h3 className="section-title mb-4">Expense Analytics Summary</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              ['Avg Monthly Cost', `₹${fmt(Math.round(analytics.summary.avg_monthly_cost || 0))}`],
              ['Max Monthly Cost', `₹${fmt(Math.round(analytics.summary.max_monthly_cost || 0))}`],
              ['Min Monthly Cost', `₹${fmt(Math.round(analytics.summary.min_monthly_cost || 0))}`],
              ['Months Tracked',   analytics.summary.months_tracked],
            ].map(([label, val]) => (
              <div key={label} className="p-4 rounded-xl bg-surface-2 border border-line">
                <p className="text-xs text-fg-subtle mb-1">{label}</p>
                <p className="text-xl font-bold text-fg">{val}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function TenantDashboard() {
  return (
    <Layout>
      <Routes>
        <Route index               element={<Overview />} />
        <Route path="documents"    element={<TenantDocuments />} />
        <Route path="payments"     element={<TenantPayments />} />
        <Route path="analytics"    element={<AnalyticsPage />} />
        <Route path="search"       element={<PropertySearch />} />
        <Route path="maintenance"  element={<TenantMaintenance />} />
        <Route path="notifications" element={<TenantNotifications />} />
      </Routes>
    </Layout>
  )
}
