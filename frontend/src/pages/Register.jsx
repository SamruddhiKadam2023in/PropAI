import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'
import { errorMessage } from '../utils/http'
import { Building2, ChevronRight, Eye, EyeOff } from 'lucide-react'

const ROLE_INFO = [
  {
    role: 'tenant',
    label: 'Tenant',
    color: 'bg-emerald-500',
    border: 'border-emerald-400',
    perks: [
      'View rent payment history & download receipts',
      'Upload utility bills — OCR extracts amounts automatically',
      'See living cost breakdown & expense trends',
      'KNN-based rent market comparison',
    ],
  },
  {
    role: 'owner',
    label: 'Property Owner',
    color: 'bg-blue-500',
    border: 'border-blue-400',
    perks: [
      'Manage entire property portfolio',
      'Download financial PDF & Excel reports',
      'View analytics per property with 12-month trends',
      'KNN market rent comparison',
    ],
  },
]

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ full_name: '', email: '', password: '', phone: '', role: 'tenant' })
  const [showPass, setShowPass] = useState(false)
  const [loading,  setLoading]  = useState(false)

  const selectedRole = ROLE_INFO.find(r => r.role === form.role) || ROLE_INFO[0]
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (form.password.length < 8) { toast.error('Password must be at least 8 characters'); return }
    if (new TextEncoder().encode(form.password).length > 72) { toast.error('Password is too long (72 bytes at most)'); return }
    setLoading(true)
    try {
      const started = await register({ ...form, email: form.email.trim(), full_name: form.full_name.trim() })
      // No session yet: the account is unverified until the emailed code is entered.
      navigate('/verify-email', { state: { email: started.email, resendIn: started.resend_in, emailSent: started.email_sent } })
    } catch (err) {
      toast.error(errorMessage(err, 'Registration failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel ── */}
      <div className="hidden lg:flex flex-col justify-between w-[48%] bg-gradient-to-br from-indigo-950 via-indigo-800 to-violet-900 p-12 relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 -left-16 w-72 h-72 bg-violet-500/20 rounded-full blur-3xl" />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-11 h-11 bg-white/10 border border-white/20 rounded-2xl flex items-center justify-center">
              <Building2 size={22} className="text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-lg leading-none">PropAI</p>
              <p className="text-indigo-300 text-xs">AI-Driven Property Management</p>
            </div>
          </div>

          <h1 className="text-3xl font-bold text-white mb-3">Create your account</h1>
          <p className="text-indigo-200 text-sm mb-10 leading-relaxed">
            Choose your role below to see what you'll get access to on the platform.
          </p>

          {/* Role cards */}
          <div className="space-y-3">
            {ROLE_INFO.map(({ role, label, color, border, perks }) => (
              <button key={role} onClick={() => setForm({ ...form, role })}
                className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${
                  form.role === role
                    ? `${border} bg-white/10`
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}>
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-7 h-7 ${color} rounded-lg flex items-center justify-center text-white text-xs font-bold`}>
                    {label[0]}
                  </div>
                  <span className="text-white font-semibold text-sm">{label}</span>
                  {form.role === role && (
                    <span className="ml-auto text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">Selected</span>
                  )}
                </div>
                {form.role === role && (
                  <ul className="space-y-1 mt-2">
                    {perks.map(p => (
                      <li key={p} className="flex items-start gap-2 text-indigo-200 text-xs">
                        <ChevronRight size={11} className="mt-0.5 flex-shrink-0 text-indigo-400" />
                        {p}
                      </li>
                    ))}
                  </ul>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-xs text-indigo-400">
          Major Project — MES Pillai CoE · ECS Dept · Prof. Padmaja Bangde
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white dark:bg-gray-900">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center">
              <Building2 size={18} className="text-white" />
            </div>
            <span className="font-bold text-gray-900 dark:text-white">PropAI</span>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Create account</h2>
          <p className="text-gray-400 text-sm mb-8">Join the PropAI platform</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Full Name</label>
              <input className="input-white" required placeholder="Amit Kumar"
                value={form.full_name} onChange={set('full_name')} />
            </div>
            <div>
              <label className="label">Email Address</label>
              <input className="input-white" type="email" required placeholder="amit@example.in"
                value={form.email} onChange={set('email')} />
            </div>
            <div>
              <label className="label">Phone Number</label>
              <input className="input-white" placeholder="+91 98765 43210"
                value={form.phone} onChange={set('phone')} />
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input className="input-white pr-10" type={showPass ? 'text' : 'password'} required minLength={8}
                  placeholder="Min 8 characters" autoComplete="new-password" aria-describedby="pw-hint"
                  value={form.password} onChange={set('password')} />
                <button type="button" onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p id="pw-hint" className="text-xs text-gray-500 dark:text-gray-400 mt-1">At least 8 characters. We'll email you a code to verify your address.</p>
            </div>
            <div>
              <label className="label">I am a…</label>
              <select className="input-white" value={form.role} onChange={set('role')}>
                <option value="tenant">Tenant</option>
                <option value="owner">Property Owner</option>
              </select>
            </div>

            {/* Mobile role perks */}
            <div className="lg:hidden p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
              <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 mb-2">{selectedRole.label} access includes:</p>
              <ul className="space-y-1">
                {selectedRole.perks.slice(0, 2).map(p => (
                  <li key={p} className="text-xs text-indigo-600 dark:text-indigo-300 flex items-start gap-1">
                    <ChevronRight size={10} className="mt-0.5 flex-shrink-0" />{p}
                  </li>
                ))}
              </ul>
            </div>

            <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2 mt-2" disabled={loading}>
              {loading ? 'Creating account…' : (<>Create Account <ChevronRight size={16} /></>)}
            </button>
          </form>

          <p className="text-center text-sm text-gray-400 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-indigo-600 hover:underline font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
