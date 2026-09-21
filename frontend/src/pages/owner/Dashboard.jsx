import { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from '../../components/Layout'
import DocumentUpload from '../../components/DocumentUpload'
import OwnerMaintenance from './Maintenance'
import AgreementsManager from '../../components/agreements/AgreementsManager'
import { MonthlyExpenseBar } from '../../components/Charts'
import api from '../../services/api'
import { assetUrl } from '../../utils/assets'
import toast from 'react-hot-toast'
import {
  Home, Users, BarChart2, FileText, Download, Plus, X,
  MapPin, BedDouble, Bath, Maximize2, TrendingUp, CheckCircle2,
  IndianRupee, Building2, ToggleLeft, ToggleRight,
  Clock, XCircle, UserCheck, RefreshCw,
} from 'lucide-react'

const fmt = (n) => n?.toLocaleString('en-IN') ?? '—'

async function downloadBlob(url, filename, mime = 'application/pdf') {
  try {
    const res = await api.get(url, { responseType: 'blob' })
    const blobUrl = window.URL.createObjectURL(new Blob([res.data], { type: mime }))
    const a = document.createElement('a')
    a.href = blobUrl; a.download = filename
    document.body.appendChild(a); a.click(); a.remove()
    window.URL.revokeObjectURL(blobUrl)
  } catch { toast.error('Failed to download report') }
}

const PROP_GRADIENTS = [
  'from-indigo-500 to-violet-600',
  'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',
  'from-orange-500 to-amber-600',
  'from-rose-500 to-pink-600',
]

function StatCard({ title, value, sub, icon: Icon, iconBg, iconColor }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${iconBg}`}>
        <Icon size={19} className={iconColor} />
      </div>
      <div>
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{title}</p>
        <p className="text-xl font-bold text-gray-900 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function PropertyCard({ property, onToggle, onReport, onImageUploaded }) {
  const gradient = PROP_GRADIENTS[property.id % PROP_GRADIENTS.length]
  const amenities = (() => { try { return JSON.parse(property.amenities || '[]') } catch { return [] } })()

  const handleImageUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    try {
      await api.post(`/properties/${property.id}/upload-image`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast.success('Image uploaded!')
      onImageUploaded?.()
    } catch { toast.error('Image upload failed') }
  }

  return (
    <div className="card-hover overflow-hidden p-0">
      {/* Property image or gradient header */}
      {property.image_url ? (
        <div className="relative h-40 overflow-hidden">
          <img src={assetUrl(property.image_url)} alt={property.title}
            className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
            <div>
              <p className="text-white/80 text-xs font-medium">{property.property_type?.toUpperCase()}</p>
              <h3 className="font-bold text-white text-base leading-snug">{property.title}</h3>
              <div className="flex items-center gap-1 text-white/80 text-xs mt-0.5">
                <MapPin size={10} /><span>{property.city}, {property.state}</span>
              </div>
            </div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${property.is_available ? 'bg-white/20 text-white' : 'bg-black/30 text-white/90'}`}>
              {property.is_available ? 'Available' : 'Occupied'}
            </span>
          </div>
        </div>
      ) : (
      <div className={`bg-gradient-to-br ${gradient} p-5 text-white`}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-white/70 text-xs font-medium mb-0.5">{property.property_type?.toUpperCase()}</p>
            <h3 className="font-bold text-lg leading-snug">{property.title}</h3>
            <div className="flex items-center gap-1 mt-1.5 text-white/80 text-xs">
              <MapPin size={11} />
              <span>{property.city}, {property.state}</span>
            </div>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${property.is_available ? 'bg-white/20 text-white' : 'bg-black/20 text-white/90'}`}>
            {property.is_available ? 'Available' : 'Occupied'}
          </span>
        </div>
        <div className="flex gap-5 mt-4 pt-4 border-t border-white/20 text-sm">
          {property.bedrooms && <div className="flex items-center gap-1.5 text-white/80"><BedDouble size={14}/>{property.bedrooms} BHK</div>}
          {property.bathrooms && <div className="flex items-center gap-1.5 text-white/80"><Bath size={14}/>{property.bathrooms} Bath</div>}
          {property.area_sqft && <div className="flex items-center gap-1.5 text-white/80"><Maximize2 size={13}/>{property.area_sqft} sqft</div>}
        </div>
      </div>
      )}

      {/* Body */}
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs text-gray-400">Monthly Rent</p>
            <p className="text-2xl font-bold text-gray-900">₹{fmt(property.rent_amount)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Annual Income</p>
            <p className="text-sm font-bold text-emerald-600">₹{fmt(property.rent_amount * 12)}</p>
          </div>
        </div>

        {property.description && (
          <p className="text-xs text-gray-400 mb-3 line-clamp-2">{property.description}</p>
        )}

        {amenities.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {amenities.slice(0, 4).map(a => (
              <span key={a} className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">{a}</span>
            ))}
            {amenities.length > 4 && (
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">+{amenities.length - 4} more</span>
            )}
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <button onClick={() => onToggle(property)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
            {property.is_available ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
            {property.is_available ? 'Mark Occupied' : 'Mark Available'}
          </button>
          <button onClick={() => onReport(property.id, 'pdf')}
            className="tap flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
            <Download size={13} /> PDF
          </button>
          <button onClick={() => onReport(property.id, 'excel')}
            className="tap flex items-center gap-1.5 px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 transition-colors">
            <Download size={13} /> Excel
          </button>
          <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-600 hover:bg-emerald-100 transition-colors cursor-pointer">
            <Plus size={13} /> Photo
            <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          </label>
        </div>
      </div>
    </div>
  )
}

function Overview() {
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/properties/').then(r => { setProperties(r.data); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-400 text-sm">Loading dashboard…</p>
      </div>
    </div>
  )

  const occupied   = properties.filter(p => !p.is_available).length
  const totalRent  = properties.reduce((s, p) => s + (p.rent_amount || 0), 0)
  const occupiedRent = properties.filter(p => !p.is_available).reduce((s, p) => s + (p.rent_amount || 0), 0)

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Owner Dashboard</h1>
        <p className="text-gray-400 text-sm mt-0.5">Manage your portfolio and financial performance</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Properties" value={properties.length}
          icon={Building2} iconBg="bg-indigo-50" iconColor="text-indigo-600" />
        <StatCard title="Occupied" value={`${occupied}/${properties.length}`}
          icon={Users} iconBg="bg-emerald-50" iconColor="text-emerald-600"
          sub={`${properties.length - occupied} available`} />
        <StatCard title="Monthly Income" value={`₹${fmt(Math.round(occupiedRent))}`}
          icon={IndianRupee} iconBg="bg-amber-50" iconColor="text-amber-600"
          sub="From occupied properties" />
        <StatCard title="Annual Potential" value={`₹${fmt(Math.round(totalRent * 12))}`}
          icon={TrendingUp} iconBg="bg-violet-50" iconColor="text-violet-600"
          sub="All properties at 100%" />
      </div>

      {/* Property list summary */}
      <div className="card">
        <h3 className="section-title mb-4">Portfolio Overview</h3>
        {properties.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">No properties yet. Go to Properties to add one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-head text-left">Property</th>
                  <th className="table-head text-left">Location</th>
                  <th className="table-head text-left">Type</th>
                  <th className="table-head text-right">Rent</th>
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
        )}
      </div>
    </div>
  )
}

function PropertiesPage() {
  const [properties, setProperties] = useState([])
  const [showForm, setShowForm]     = useState(false)
  const [form, setForm] = useState({
    title: '', address: '', city: '', state: '', pincode: '',
    property_type: 'apartment', bedrooms: '', bathrooms: '', area_sqft: '', rent_amount: '',
    description: '', amenities: '',
  })

  const load = () => api.get('/properties/').then(r => setProperties(r.data)).catch(() => {})
  useEffect(() => { load() }, [])

  const handleToggle = async (prop) => {
    try {
      await api.patch(`/properties/${prop.id}`, { is_available: !prop.is_available })
      toast.success(`Marked as ${prop.is_available ? 'occupied' : 'available'}`)
      load()
    } catch { toast.error('Update failed') }
  }

  const handleReport = (id, type) => {
    if (type === 'pdf') {
      downloadBlob(`/reports/financial/${id}/pdf`, `report_${id}.pdf`, 'application/pdf')
    } else {
      downloadBlob(`/reports/financial/${id}/excel`, `report_${id}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    }
  }

  const handleAdd = async (e) => {
    e.preventDefault()
    try {
      const amenitiesArr = form.amenities
        ? JSON.stringify(form.amenities.split(',').map(a => a.trim()).filter(Boolean))
        : '[]'
      await api.post('/properties/', {
        ...form,
        bedrooms:    parseInt(form.bedrooms) || undefined,
        bathrooms:   parseInt(form.bathrooms) || undefined,
        area_sqft:   parseFloat(form.area_sqft) || undefined,
        rent_amount: parseFloat(form.rent_amount),
        amenities:   amenitiesArr,
      })
      toast.success('Property added!')
      setShowForm(false)
      setForm({ title:'', address:'', city:'', state:'', pincode:'', property_type:'apartment', bedrooms:'', bathrooms:'', area_sqft:'', rent_amount:'', description:'', amenities:'' })
      load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to add property') }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Properties</h1>
          <p className="text-gray-400 text-sm mt-0.5">Manage your property portfolio</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2">
          {showForm ? <X size={16} /> : <Plus size={16} />}
          {showForm ? 'Cancel' : 'Add Property'}
        </button>
      </div>

      {showForm && (
        <div className="card border-2 border-indigo-100">
          <h3 className="section-title mb-4">Add New Property</h3>
          <form onSubmit={handleAdd} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Property Title *</label>
              <input className="input" required placeholder="e.g. Antriksh Heights — 2BHK"
                value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
            </div>
            <div className="col-span-2">
              <label className="label">Address *</label>
              <input className="input" required placeholder="Full address"
                value={form.address} onChange={e => setForm({...form, address: e.target.value})} />
            </div>
            <div>
              <label className="label">City *</label>
              <input className="input" required placeholder="Mumbai"
                value={form.city} onChange={e => setForm({...form, city: e.target.value})} />
            </div>
            <div>
              <label className="label">State *</label>
              <input className="input" required placeholder="Maharashtra"
                value={form.state} onChange={e => setForm({...form, state: e.target.value})} />
            </div>
            <div>
              <label className="label">Pincode *</label>
              <input className="input" required placeholder="400001"
                value={form.pincode} onChange={e => setForm({...form, pincode: e.target.value})} />
            </div>
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.property_type} onChange={e => setForm({...form, property_type: e.target.value})}>
                <option value="apartment">Apartment</option>
                <option value="house">House / Villa</option>
                <option value="commercial">Commercial</option>
              </select>
            </div>
            <div>
              <label className="label">Bedrooms</label>
              <input className="input" type="number" placeholder="2"
                value={form.bedrooms} onChange={e => setForm({...form, bedrooms: e.target.value})} />
            </div>
            <div>
              <label className="label">Bathrooms</label>
              <input className="input" type="number" placeholder="2"
                value={form.bathrooms} onChange={e => setForm({...form, bathrooms: e.target.value})} />
            </div>
            <div>
              <label className="label">Area (sqft)</label>
              <input className="input" type="number" placeholder="950"
                value={form.area_sqft} onChange={e => setForm({...form, area_sqft: e.target.value})} />
            </div>
            <div>
              <label className="label">Monthly Rent (₹) *</label>
              <input className="input" type="number" required placeholder="48000"
                value={form.rent_amount} onChange={e => setForm({...form, rent_amount: e.target.value})} />
            </div>
            <div className="col-span-2">
              <label className="label">Amenities (comma-separated)</label>
              <input className="input" placeholder="Gym, Parking, Swimming Pool, 24x7 Security"
                value={form.amenities} onChange={e => setForm({...form, amenities: e.target.value})} />
            </div>
            <div className="col-span-2">
              <label className="label">Description</label>
              <textarea className="input" rows={2} placeholder="Brief property description"
                value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
            </div>
            <div className="col-span-2">
              <button type="submit" className="btn-primary">Add Property</button>
            </div>
          </form>
        </div>
      )}

      {properties.length === 0 ? (
        <div className="card text-center py-16">
          <Building2 size={40} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No properties yet</p>
          <p className="text-gray-400 text-sm mt-1">Click "Add Property" to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {properties.map(p => (
            <PropertyCard key={p.id} property={p} onToggle={handleToggle} onReport={handleReport} onImageUploaded={load} />
          ))}
        </div>
      )}
    </div>
  )
}

function ApplicationsPage() {
  const [apps, setApps]     = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/properties/owner-applications')
      setApps(r.data)
    } catch { toast.error('Failed to load applications') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const approve = async (id) => {
    try {
      await api.patch(`/properties/applications/${id}/approve`)
      toast.success('Application approved — tenant assigned to property!')
      load()
    } catch { toast.error('Failed to approve') }
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
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rental Applications</h1>
          <p className="text-gray-400 text-sm mt-0.5">Review and approve tenant applications for your properties</p>
        </div>
        <button onClick={load} className="btn-ghost flex items-center gap-2 text-sm">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        </div>
      ) : apps.length === 0 ? (
        <div className="card text-center py-16">
          <UserCheck size={40} className="text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No applications yet</p>
          <p className="text-gray-400 text-sm mt-1">When tenants apply for your properties, they'll appear here</p>
        </div>
      ) : (
        <div className="space-y-4">
          {apps.map(app => {
            const s = STATUS[app.status] || STATUS.pending
            return (
              <div key={app._id} className="card flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-gray-900">{app.property_title}</p>
                    <span className={s.cls}>{s.label}</span>
                  </div>
                  <p className="text-xs text-gray-400 flex items-center gap-1 mb-2">
                    <MapPin size={10} /> {app.property_address}
                  </p>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <div>
                      <p className="text-xs text-gray-400">Applicant</p>
                      <p className="font-medium text-gray-800">{app.tenant_name}</p>
                      <p className="text-xs text-gray-400">{app.tenant_email}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Rent</p>
                      <p className="font-bold text-indigo-600">₹{Number(app.rent_amount).toLocaleString('en-IN')}/mo</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Applied</p>
                      <p className="text-gray-700">{new Date(app.applied_at).toLocaleDateString('en-IN')}</p>
                    </div>
                  </div>
                </div>
                {app.status === 'pending' && (
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
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DocumentsPage() {
  const [properties, setProperties] = useState([])
  const [selected, setSelected]     = useState('')
  useEffect(() => {
    api.get('/properties/').then(r => { setProperties(r.data); if (r.data[0]) setSelected(String(r.data[0].id)) }).catch(() => {})
  }, [])
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
        <p className="text-gray-400 text-sm mt-0.5">Upload bills and invoices for AI-powered OCR extraction</p>
      </div>
      {properties.length > 1 && (
        <div>
          <label className="label">Select Property</label>
          <select className="input w-auto" value={selected} onChange={e => setSelected(e.target.value)}>
            {properties.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
      )}
      {selected && <DocumentUpload propertyId={parseInt(selected)} />}
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
          <p className="text-gray-400 text-sm mt-0.5">AI-powered expense and rent intelligence per property</p>
        </div>
        {properties.length > 1 && (
          <select className="input w-auto" value={selected} onChange={e => setSelected(e.target.value)}>
            {properties.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        )}
      </div>

      {/* KNN Market Comparison */}
      {dev && (
        <div className="card">
          <h3 className="section-title mb-1">KNN Rent Market Comparison</h3>
          <p className="section-subtitle mb-4">K-Nearest Neighbors analysis against similar properties</p>
          <div className="grid grid-cols-3 gap-4 mb-4">
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
          {market.similar_properties?.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-600 mb-2">Comparable Properties</p>
              <div className="grid grid-cols-2 gap-2">
                {market.similar_properties.slice(0, 4).map((p, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 text-sm border border-slate-100">
                    <div>
                      <p className="font-medium text-gray-800 text-xs">{p.title}</p>
                      <p className="text-gray-400 text-xs">{p.city} · {p.bedrooms}BHK · {p.area_sqft} sqft</p>
                    </div>
                    <p className="font-bold text-gray-900 text-sm">₹{fmt(p.rent_amount)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Expense trend chart */}
      {chartData.length > 0 && (
        <div className="card">
          <h3 className="section-title mb-1">Monthly Utility Expense Trend</h3>
          <p className="section-subtitle mb-4">12-month expense history with category breakdown (₹)</p>
          <MonthlyExpenseBar data={chartData} />
        </div>
      )}

      {/* Summary */}
      {analytics?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            ['Avg Monthly Cost', `₹${fmt(Math.round(analytics.summary.avg_monthly_cost || 0))}`],
            ['Peak Monthly Cost', `₹${fmt(Math.round(analytics.summary.max_monthly_cost || 0))}`],
            ['Lowest Monthly Cost', `₹${fmt(Math.round(analytics.summary.min_monthly_cost || 0))}`],
            ['Months of Data', analytics.summary.months_tracked],
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

export default function OwnerDashboard() {
  return (
    <Layout>
      <Routes>
        <Route index                 element={<Overview />} />
        <Route path="properties"     element={<PropertiesPage />} />
        <Route path="applications"   element={<ApplicationsPage />} />
        <Route path="documents"      element={<DocumentsPage />} />
        <Route path="analytics"      element={<AnalyticsPage />} />
        <Route path="maintenance"    element={<OwnerMaintenance />} />
        <Route path="agreements"     element={<AgreementsManager />} />
      </Routes>
    </Layout>
  )
}
