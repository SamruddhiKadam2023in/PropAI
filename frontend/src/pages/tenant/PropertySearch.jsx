import { useState, useEffect, useCallback } from 'react'
import api from '../../services/api'
import { assetUrl } from '../../utils/assets'
import toast from 'react-hot-toast'
import { useAuth } from '../../contexts/AuthContext'
import {
  Search, MapPin, BedDouble, Bath, Maximize2, IndianRupee,
  Home, CheckCircle2, Clock, XCircle, Wifi, Zap, Droplets,
  Star, ChevronRight, Filter, RefreshCw, Building2,
  Database, Globe, X, Phone, Mail, MessageSquare, Download,
} from 'lucide-react'

const fmt = (n) => Number(n).toLocaleString('en-IN')

const AMENITY_ICONS = {
  'wifi ready': Wifi, 'wifi': Wifi,
  'power backup': Zap, 'electricity': Zap,
  'water': Droplets, 'swimming pool': Droplets,
  'gym': Star, 'club house': Star,
  'parking': Home, 'visitor parking': Home,
  'security': CheckCircle2, '24x7 security': CheckCircle2,
}

function AmenityTag({ name }) {
  const key = name?.toLowerCase()
  const Icon = Object.entries(AMENITY_ICONS).find(([k]) => key?.includes(k))?.[1] || CheckCircle2
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent-soft text-accent-text text-[11px] font-medium rounded-full">
      <Icon size={9} /> {name}
    </span>
  )
}

function PropertyCard({ prop, onApply, appliedIds, source }) {
  const applied = source === 'internal' && appliedIds.has(prop.id)
  const GRAD = ['tone-indigo', 'tone-blue', 'tone-emerald', 'tone-amber', 'tone-rose', 'tone-slate']
  const gradIdx = typeof prop.id === 'number' ? prop.id : (prop.id?.charCodeAt(4) || 0)
  const grad = GRAD[gradIdx % GRAD.length]
  const amenities = Array.isArray(prop.amenities)
    ? prop.amenities
    : (prop.amenities || '').split(',').map(s => s.trim()).filter(Boolean)

  return (
    <div className="card-hover overflow-hidden flex flex-col">
      {prop.image_url ? (
        <div className="relative h-40 overflow-hidden">
          <img src={assetUrl(prop.image_url)} alt={prop.title}
            className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute bottom-3 left-4 right-4">
            <p className="text-white font-bold text-base leading-tight">{prop.title}</p>
            <p className="text-white/90 text-xs mt-0.5 flex items-center gap-1"><MapPin size={10} /> {prop.address}</p>
            <p className="text-white text-xl font-bold mt-1">₹{fmt(prop.rent_amount)}<span className="text-white/90 text-xs font-normal">/mo</span></p>
          </div>
          {source === 'external' && (
            <span className="absolute top-2 right-2 bg-success text-white text-[9px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-0.5">
              <Globe size={8} /> PropAI
            </span>
          )}
        </div>
      ) : (
      <div className={`${grad} p-5 relative overflow-hidden`}>
        <div className="absolute -top-6 -right-6 w-24 h-24 bg-white/10 rounded-full" />
        <div className="absolute -bottom-4 -left-4 w-16 h-16 bg-white/10 rounded-full" />
        <div className="relative z-10">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1 mr-2">
              <p className="text-white font-bold text-base leading-tight">{prop.title}</p>
              <p className="text-white/90 text-xs mt-0.5 flex items-center gap-1">
                <MapPin size={10} /> {prop.address}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="bg-black/25 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize">
                {prop.property_type}
              </span>
              {source === 'external' && (
                <span className="bg-black/25 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                  <Globe size={8} /> PropAI Listings
                </span>
              )}
            </div>
          </div>
          <div className="flex items-end gap-1 mt-3">
            <span className="text-white text-2xl font-bold">₹{fmt(prop.rent_amount)}</span>
            <span className="text-white/90 text-xs mb-0.5">/month</span>
          </div>
        </div>
      </div>
      )}

      <div className="p-5 flex-1 flex flex-col">
        <div className="flex gap-4 mb-3">
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            <BedDouble size={13} className="text-accent-text" />
            <span className="font-semibold">{prop.bedrooms}</span> BHK
          </div>
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Bath size={13} className="text-info-fg" />
            <span className="font-semibold">{prop.bathrooms}</span> Bath
          </div>
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Maximize2 size={13} className="text-success-fg" />
            <span className="font-semibold">{prop.area_sqft}</span> sq.ft
          </div>
        </div>

        {prop.description && (
          <p className="text-xs text-fg-muted mb-3 leading-relaxed line-clamp-2">{prop.description}</p>
        )}

        {amenities.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {amenities.slice(0, 4).map(a => <AmenityTag key={a} name={a} />)}
            {amenities.length > 4 && (
              <span className="text-[11px] text-fg-subtle">+{amenities.length - 4} more</span>
            )}
          </div>
        )}

        <div className="mt-auto pt-3 border-t border-line flex items-center justify-between">
          <div>
            <p className="text-[10px] text-fg-subtle">Security Deposit</p>
            <p className="text-sm font-semibold text-fg">
              ₹{fmt(prop.security_deposit || prop.rent_amount * 2)}
            </p>
          </div>
          {source === 'internal' ? (
            <button
              onClick={() => onApply(prop)}
              disabled={applied}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                applied
                  ? 'bg-success-soft text-success-fg cursor-default'
                  : 'bg-accent hover:bg-accent-hover text-accent-on shadow-sm'
              }`}
            >
              {applied ? (<><CheckCircle2 size={14} /> Applied</>) : (<>Apply <ChevronRight size={14} /></>)}
            </button>
          ) : (
            <button
              onClick={() => setEnquiryProp(prop)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-success hover:bg-success-hover text-white shadow-sm transition-all"
            >
              Enquire Now <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ApplicationRow({ app }) {
  const STATUS = {
    pending:  { cls: 'badge-yellow', label: 'Pending Review' },
    approved: { cls: 'badge-green',  label: 'Approved' },
    rejected: { cls: 'badge-red',    label: 'Rejected' },
    enquiry:  { cls: 'badge-blue',   label: 'Enquiry Sent' },
  }
  const s = STATUS[app.status] || STATUS.pending

  const downloadLease = async () => {
    try {
      const res = await api.get(`/reports/lease/${app.id}/pdf`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a'); a.href = url; a.download = `lease_${app.id}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      window.URL.revokeObjectURL(url)
    } catch { toast.error('Failed to download lease') }
  }

  return (
    <div className="flex items-center justify-between py-3 border-b border-line last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-fg truncate">{app.property_title}</p>
        <p className="text-xs text-fg-subtle truncate">{app.property_address}, {app.property_city}</p>
        <p className="text-xs text-fg-subtle mt-0.5">Applied {new Date(app.applied_at).toLocaleDateString('en-IN')}</p>
      </div>
      <div className="flex items-center gap-2 ml-4 flex-shrink-0">
        <p className="text-sm font-bold text-accent-text">₹{fmt(app.rent_amount)}/mo</p>
        <span className={s.cls}>{s.label}</span>
        {app.status === 'approved' && app.id && (
          <button onClick={downloadLease}
            className="flex items-center gap-1 text-xs px-2 py-1 bg-accent text-white rounded-lg hover:bg-accent-hover">
            <Download size={11} /> Lease
          </button>
        )}
      </div>
    </div>
  )
}

function EnquiryModal({ prop, onClose, onSubmit }) {
  const { user } = useAuth()
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const fmt = (n) => Number(n).toLocaleString('en-IN')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await onSubmit(prop, message)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay/60 backdrop-blur-sm">
      <div className="bg-surface border border-line rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-line">
          <div>
            <h3 className="font-bold text-fg">Enquire About This Property</h3>
            <p className="text-xs text-fg-subtle mt-0.5">Your details will be shared with the owner</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-fg-subtle hover:text-fg rounded-lg hover:bg-surface-3">
            <X size={18} />
          </button>
        </div>

        {/* Property summary */}
        <div className="mx-5 mt-4 p-3 bg-accent-soft rounded-xl">
          <p className="font-semibold text-fg text-sm">{prop.title}</p>
          <div className="flex items-center gap-1 text-xs text-accent-text mt-0.5">
            <MapPin size={10} /> {prop.address}
          </div>
          <div className="flex gap-3 mt-2 text-xs text-accent-text font-medium">
            <span>₹{fmt(prop.rent_amount)}/mo</span>
            <span>·</span>
            <span>{prop.bedrooms} BHK</span>
            <span>·</span>
            <span>{prop.area_sqft} sq.ft</span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Auto-filled contact info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1 text-xs text-fg-muted font-medium mb-1">
                <Mail size={11} /> Your Email
              </label>
              <input className="input text-sm bg-surface-2" value={user?.email || ''} readOnly />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs text-fg-muted font-medium mb-1">
                <Phone size={11} /> Your Phone
              </label>
              <input className="input text-sm bg-surface-2" value={user?.phone || 'Not set'} readOnly />
            </div>
          </div>

          <div>
            <label className="flex items-center gap-1 text-xs text-fg-muted font-medium mb-1">
              <MessageSquare size={11} /> Message to Owner <span className="text-fg-subtle">(optional)</span>
            </label>
            <textarea
              className="input text-sm resize-none"
              rows={3}
              placeholder="e.g. I'm interested in this property. Please contact me at your earliest convenience."
              value={message}
              onChange={e => setMessage(e.target.value)}
            />
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1 flex items-center justify-center gap-2">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Submit Enquiry
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const CITIES = ['Mumbai', 'Navi Mumbai', 'Pune', 'Bangalore', 'Hyderabad', 'Delhi', 'Gurgaon', 'Noida', 'Chennai', 'Kolkata']

export default function PropertySearch() {
  const [tab,        setTab]        = useState('search')
  const [mode,       setMode]       = useState('internal')
  const [city,       setCity]       = useState('')
  const [bedrooms,   setBedrooms]   = useState('')
  const [maxRent,    setMaxRent]    = useState('')
  const [results,    setResults]    = useState([])
  const [apps,       setApps]       = useState([])
  const [loading,    setLoading]    = useState(false)
  const [searched,   setSearched]   = useState(false)
  const [appliedIds, setAppliedIds] = useState(new Set())
  const [enquiryProp, setEnquiryProp] = useState(null)

  const loadApplications = useCallback(async () => {
    try {
      const r = await api.get('/properties/my-applications')
      setApps(r.data)
      setAppliedIds(new Set(r.data.map(a => a.property_id)))
    } catch { /* silent */ }
  }, [])

  useEffect(() => { loadApplications() }, [loadApplications])

  const handleSearch = async (e) => {
    e?.preventDefault()
    setLoading(true)
    setSearched(true)
    try {
      if (mode === 'listings') {
        const params = { city: city.trim() }
        if (bedrooms)  params.bedrooms = Number(bedrooms)
        if (maxRent)   params.max_rent = Number(maxRent)
        const r = await api.get('/properties/listings', { params })
        setResults(r.data)
      } else {
        const params = {}
        if (city.trim()) params.city     = city.trim()
        if (bedrooms)    params.bedrooms = Number(bedrooms)
        if (maxRent)     params.max_rent = Number(maxRent)
        const r = await api.get('/properties/search', { params })
        setResults(r.data)
      }
    } catch {
      toast.error('Search failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleApply = async (prop) => {
    try {
      await api.post(`/properties/${prop.id}/apply`)
      toast.success(`Application sent for "${prop.title}"!`)
      setAppliedIds(prev => new Set([...prev, prop.id]))
      await loadApplications()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Application failed')
    }
  }

  const handleEnquiry = async (prop, message) => {
    try {
      await api.post('/properties/enquiry', {
        property_title:   prop.title,
        property_address: prop.address,
        property_city:    prop.city || city,
        rent_amount:      prop.rent_amount,
        bedrooms:         prop.bedrooms,
        area_sqft:        prop.area_sqft,
        message:          message || 'I am interested in this property.',
        source:           'propai_listing',
      })
      toast.success(`Enquiry submitted for "${prop.title}"!`)
      await loadApplications()
    } catch {
      toast.error('Failed to submit enquiry. Please try again.')
    }
  }

  // Auto-search on mount with Mumbai listings
  useEffect(() => { handleSearch() }, []) // eslint-disable-line

  return (
    <div className="space-y-6">
      {enquiryProp && (
        <EnquiryModal
          prop={enquiryProp}
          onClose={() => setEnquiryProp(null)}
          onSubmit={handleEnquiry}
        />
      )}
      {/* Hero */}
      <div className="tone-indigo rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full" />
        <div className="absolute -bottom-6 left-20 w-28 h-28 bg-white/10 rounded-full" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <Building2 size={20} />
            <span className="text-sm font-medium text-white/90">PropAI Property Search</span>
          </div>
          <h1 className="text-2xl font-bold mb-1">Find Your Next Home</h1>
          <p className="text-white/90 text-sm">
            Browse verified rental properties across 10 major Indian cities — Mumbai, Bangalore, Hyderabad & more
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-2 p-1 rounded-xl w-fit">
        {[
          { key: 'search',       label: 'Search Properties' },
          { key: 'applications', label: `My Applications${apps.length ? ` (${apps.length})` : ''}` },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === key ? 'bg-surface shadow-sm text-accent-text' : 'text-fg-muted hover:text-fg'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'search' && (
        <>
          {/* Search controls */}
          <div className="card p-4 space-y-3">
            {/* Source toggle */}
            <div className="flex gap-2">
              {[
                { key: 'listings', label: 'PropAI Listings', icon: Globe,    desc: '1,000+ verified properties' },
                { key: 'internal', label: 'My City (DB)',    icon: Database, desc: 'PropAI managed properties' },
              ].map(({ key, label, icon: Icon, desc }) => (
                <button key={key} onClick={() => { setMode(key); setResults([]); setSearched(false) }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border-2 transition-all ${
                    mode === key
                      ? 'border-accent bg-accent-soft text-accent-text'
                      : 'border-line text-fg-muted hover:border-line-strong'
                  }`}>
                  <Icon size={14} /> {label}
                  <span className="text-[10px] text-fg-subtle hidden sm:inline">· {desc}</span>
                </button>
              ))}
            </div>

            <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
              {/* City */}
              {mode === 'listings' ? (
                <select className="input flex-1" value={city} onChange={e => setCity(e.target.value)}>
                  {CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <div className="flex-1 relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
                  <input className="input pl-9" placeholder="City (Mumbai, Pune…)"
                    value={city} onChange={e => setCity(e.target.value)} />
                </div>
              )}

              {/* BHK */}
              <select className="input w-full sm:w-32" value={bedrooms} onChange={e => setBedrooms(e.target.value)}>
                <option value="">Any BHK</option>
                <option value="1">1 BHK</option>
                <option value="2">2 BHK</option>
                <option value="3">3 BHK</option>
              </select>

              {/* Max rent */}
              <div className="relative w-full sm:w-44">
                <IndianRupee size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
                <input className="input pl-7" type="number" placeholder="Max rent"
                  value={maxRent} onChange={e => setMaxRent(e.target.value)} />
              </div>

              <button type="submit" className="btn-primary flex items-center gap-2 whitespace-nowrap" disabled={loading}>
                {loading ? <RefreshCw size={15} className="animate-spin" /> : <Search size={15} />}
                Search
              </button>
              {searched && (
                <button type="button" onClick={() => { setResults([]); setSearched(false); setBedrooms(''); setMaxRent('') }}
                  className="btn-secondary flex items-center gap-2">
                  <Filter size={14} /> Reset
                </button>
              )}
            </form>
          </div>

          {/* Quick city chips */}
          {mode === 'listings' && !searched && (
            <div className="flex flex-wrap gap-2">
              <p className="text-xs text-fg-subtle self-center">Quick search:</p>
              {CITIES.map(c => (
                <button key={c} onClick={() => { setCity(c); setTimeout(handleSearch, 0) }}
                  className="px-3 py-1 text-xs bg-surface-2 hover:bg-accent-soft hover:text-accent-text rounded-full transition-colors font-medium">
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* Results */}
          {loading ? (
            <div className="text-center py-16 text-fg-subtle">
              <RefreshCw size={28} className="animate-spin mx-auto mb-3" />
              <p className="text-sm">Finding properties…</p>
            </div>
          ) : results.length === 0 && searched ? (
            <div className="text-center py-16 text-fg-subtle">
              <Home size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">No properties found</p>
              <p className="text-sm mt-1">Try a different city or remove filters</p>
            </div>
          ) : results.length > 0 ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-fg-muted">
                  <span className="font-semibold text-fg">{results.length}</span> properties in {city}
                  {mode === 'listings' && (
                    <span className="ml-2 text-xs text-success-fg font-medium">· PropAI Verified Listings</span>
                  )}
                </p>
                <p className="text-xs text-fg-subtle">Sorted by rent (low to high)</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {results.map((prop, i) => (
                  <PropertyCard
                    key={prop.id || i}
                    prop={prop}
                    onApply={handleApply}
                    appliedIds={appliedIds}
                    source={mode === 'internal' ? 'internal' : 'external'}
                  />
                ))}
              </div>
            </>
          ) : null}
        </>
      )}

      {tab === 'applications' && (
        <div className="card">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="section-title">My Rental Applications</h2>
              <p className="section-subtitle">Track the status of properties you've applied for</p>
            </div>
            <button onClick={loadApplications} className="btn-ghost flex items-center gap-2 text-xs">
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
          {apps.length === 0 ? (
            <div className="text-center py-12 text-fg-subtle">
              <Clock size={36} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">No applications yet</p>
              <p className="text-sm mt-1">Browse properties and click Apply to Rent</p>
              <button onClick={() => setTab('search')} className="btn-primary mt-4 text-sm">
                Find Properties
              </button>
            </div>
          ) : (
            <div>{apps.map((app, i) => <ApplicationRow key={i} app={app} />)}</div>
          )}
        </div>
      )}
    </div>
  )
}
