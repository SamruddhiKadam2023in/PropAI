import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'
import { errorMessage } from '../utils/http'
import { Building2, Brain, FileText, TrendingUp, ShieldCheck, ChevronRight } from 'lucide-react'

const FEATURES = [
  { icon: FileText,   title: 'Smart OCR Document Processing', desc: 'Auto-extract amounts, dates & vendors from bills using AI' },
  { icon: Brain,      title: 'NLP Entity Recognition',        desc: 'spaCy NER pipeline with 65% confidence scoring' },
  { icon: TrendingUp, title: 'Predictive Expense Analytics',  desc: 'KNN rent comparison + Linear Regression forecasting' },
  { icon: ShieldCheck,title: 'Role-Based Access Control',     desc: 'Tenant / Owner / Manager with JWT authentication' },
]

// Demo sign-in shortcuts exist ONLY in builds made with VITE_SHOW_DEMO_LOGIN=true (see frontend/.env, which is never deployed).
// In any other build the branch below is removed at compile time, so neither the panel nor the demo password ships to visitors.
const DEMO = __SHOW_DEMO_LOGIN__ ? [
  { role: 'Manager', email: 'rajesh@propai.in',  color: 'bg-purple-500' },
  { role: 'Owner',   email: 'vikram@propai.in',  color: 'bg-blue-500'   },
  { role: 'Tenant',  email: 'amit@example.in',   color: 'bg-emerald-500' },
] : []

export default function Login() {
  const { login } = useAuth()
  const navigate   = useNavigate()
  const [form, setForm]       = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const user = await login(form.email, form.password)
      toast.success(`Welcome back, ${user.full_name}!`)
      if (user.role === 'tenant')       navigate('/tenant')
      else if (user.role === 'owner')   navigate('/owner')
      else                              navigate('/manager')
    } catch (err) {
      const detail = err.response?.data?.detail
      if (detail?.code === 'email_not_verified') {          // right password, but the address was never confirmed
        navigate('/verify-email', { state: { email: detail.email, notice: detail.message, resendIn: 60 } })
      } else {
        toast.error(errorMessage(err, 'Invalid credentials'))    // includes "Too many failed sign-in attempts. Try again in N seconds."
      }
    } finally {
      setLoading(false)
    }
  }

  const quickLogin = (email) => setForm({ email, password: __SHOW_DEMO_LOGIN__ ? 'PropAI@2024' : '' })

  return (
    <div className="min-h-screen flex">
      {/* ── Left hero panel ── */}
      <div className="hidden lg:flex flex-col justify-between w-[52%] bg-gradient-to-br from-indigo-950 via-indigo-800 to-violet-900 p-12 relative overflow-hidden">
        {/* decorative circles */}
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 -left-16 w-72 h-72 bg-violet-500/20 rounded-full blur-3xl" />

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-11 h-11 bg-white/10 border border-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm">
              <Building2 size={22} className="text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-lg leading-none">PropAI</p>
            </div>
          </div>

          <h1 className="text-4xl font-bold text-white leading-snug mb-4">
            AI-Driven Financial<br />
            <span className="text-indigo-300">Property Management</span>
          </h1>
          <p className="text-indigo-200 text-base leading-relaxed mb-10 max-w-sm">
            Automate document processing, predict monthly expenses, and compare market rents — all powered by machine learning.
          </p>

          <div className="space-y-5">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-4">
                <div className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center flex-shrink-0 border border-white/10">
                  <Icon size={16} className="text-indigo-200" />
                </div>
                <div>
                  <p className="text-white text-sm font-semibold">{title}</p>
                  <p className="text-indigo-300 text-xs mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
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

          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Welcome back</h2>
          <p className="text-gray-400 text-sm mb-8">Sign in to your account</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email Address</label>
              <input className="input-white" type="email" required autoComplete="email"
                value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="you@example.com" />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="label">Password</label>
                <Link to="/forgot-password" className="text-xs font-medium text-indigo-600 dark:text-indigo-300 hover:underline mb-1.5" data-testid="forgot-link">Forgot password?</Link>
              </div>
              <input className="input-white" type="password" required
                value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••" />
            </div>
            <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2 mt-2" disabled={loading}>
              {loading ? 'Signing in…' : (<>Sign In <ChevronRight size={16} /></>)}
            </button>
          </form>

          <p className="text-center text-sm text-gray-400 mt-5">
            Don't have an account?{' '}
            <Link to="/register" className="text-indigo-600 hover:underline font-medium">Register</Link>
          </p>

          {/* Demo accounts (local demo builds only) */}
          {__SHOW_DEMO_LOGIN__ && (
          <div className="mt-8 p-4 bg-slate-50 dark:bg-gray-800 rounded-2xl border border-slate-100 dark:border-gray-700">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Quick Demo Login</p>
            <div className="space-y-2">
              {DEMO.map(({ role, email, color }) => (
                <button key={role} onClick={() => quickLogin(email)}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-white dark:hover:bg-gray-700 hover:shadow-sm transition-all text-left border border-transparent hover:border-gray-200 dark:hover:border-gray-600">
                  <div className={`w-7 h-7 ${color} rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                    {role[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{role}</p>
                    <p className="text-xs text-gray-400 truncate">{email}</p>
                  </div>
                  <ChevronRight size={14} className="text-gray-300" />
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3 text-center">All accounts: <span className="font-mono font-medium">PropAI@2024</span></p>
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
