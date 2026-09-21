import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Building2, ChevronRight, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'
import api from '../services/api'
import { errorMessage } from '../utils/http'

const CODE_LENGTH = 6

/** Forgotten password: (1) enter the email, (2) enter the emailed code and a new password. Existing sessions are signed out. */
export default function ForgotPassword() {
  const navigate = useNavigate()
  const [step, setStep] = useState('email')            // 'email' | 'reset'
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(0)
  const codeRef = useRef(null)

  useEffect(() => {                                     // resend countdown
    if (wait <= 0) return undefined
    const id = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(id)
  }, [wait])
  useEffect(() => { if (step === 'reset') codeRef.current?.focus() }, [step])

  const requestCode = async (e) => {
    e?.preventDefault()
    setError(null)
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter a valid email address.'); return }
    setBusy(true)
    try {
      const r = await api.post('/auth/forgot-password', { email: email.trim() })
      setWait(r.data.resend_in ?? 60)
      setStep('reset')
    } catch (err) {
      const retry = Number(err?.response?.headers?.['retry-after'])
      if (err?.response?.status === 429 && retry > 0) setWait(retry)
      setError(errorMessage(err, "We couldn't send a reset code."))
    } finally { setBusy(false) }
  }

  const reset = async (e) => {
    e.preventDefault()
    setError(null)
    if (!/^\d+$/.test(code) || code.length !== CODE_LENGTH) { setError(`Enter the ${CODE_LENGTH}-digit code from your email.`); return }
    if (password.length < 8) { setError('The new password must be at least 8 characters.'); return }
    if (new TextEncoder().encode(password).length > 72) { setError('The new password is too long (72 bytes at most).'); return }
    if (password !== confirm) { setError("The two passwords don't match."); return }
    setBusy(true)
    try {
      await api.post('/auth/reset-password', { email: email.trim(), otp: code, new_password: password })
      toast.success('Password updated. Please sign in.')
      navigate('/login', { replace: true })
    } catch (err) {
      setError(errorMessage(err, "We couldn't reset your password."))
      setCode('')
      codeRef.current?.focus()
    } finally { setBusy(false) }
  }

  const resend = async () => {
    setError(null)
    setBusy(true)
    try {
      const r = await api.post('/auth/forgot-password', { email: email.trim() })
      setWait(r.data.resend_in ?? 60)
      toast.success('If an account exists for that email, a new code is on its way.')
    } catch (err) {
      const retry = Number(err?.response?.headers?.['retry-after'])
      if (err?.response?.status === 429 && retry > 0) setWait(retry)
      setError(errorMessage(err, "We couldn't send a new code."))
    } finally { setBusy(false) }
  }

  const err = error && <p className="p-3 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200 text-sm" role="alert" data-testid="fp-error">{error}</p>

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-white dark:bg-gray-900">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center"><Building2 size={18} className="text-white" /></div>
          <span className="font-bold text-gray-900 dark:text-white">PropAI</span>
        </div>
        <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-4"><KeyRound size={22} className="text-indigo-600 dark:text-indigo-300" aria-hidden="true" /></div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Forgot your password?</h1>

        {step === 'email' ? (
          <>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">Enter your account email and we'll send you a code to reset it.</p>
            <form onSubmit={requestCode} noValidate className="space-y-4">
              <div>
                <label className="label" htmlFor="fp-email">Email Address</label>
                <input id="fp-email" className="input-white" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" data-testid="fp-email" />
              </div>
              <div aria-live="polite">{err}</div>
              <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2" disabled={busy} data-testid="fp-send">
                {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Sending…</> : (<>Send reset code <ChevronRight size={16} /></>)}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6" data-testid="fp-intro">
              If an account exists for <span className="font-semibold text-gray-800 dark:text-gray-200">{email}</span>, we've sent it a {CODE_LENGTH}-digit code. It expires in 10 minutes.
            </p>
            <form onSubmit={reset} noValidate className="space-y-4">
              <div>
                <label className="label" htmlFor="fp-code">Reset code</label>
                <input id="fp-code" ref={codeRef} className="input-white text-center text-2xl tracking-[0.5em] font-mono" inputMode="numeric" autoComplete="one-time-code"
                  maxLength={CODE_LENGTH} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••••" data-testid="fp-code" />
              </div>
              <div>
                <label className="label" htmlFor="fp-new">New password</label>
                <div className="relative">
                  <input id="fp-new" className="input-white pr-10" type={showPass ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 characters" aria-describedby="fp-hint" data-testid="fp-new" />
                  <button type="button" onClick={() => setShowPass((v) => !v)} aria-label={showPass ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400">
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p id="fp-hint" className="text-xs text-gray-500 dark:text-gray-400 mt-1">At least 8 characters. You'll be signed out everywhere else.</p>
              </div>
              <div>
                <label className="label" htmlFor="fp-confirm">Confirm new password</label>
                <input id="fp-confirm" className="input-white" type={showPass ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="fp-confirm" />
              </div>
              <div aria-live="polite">{err}</div>
              <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2" disabled={busy} data-testid="fp-submit">
                {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Updating…</> : (<>Update password <ChevronRight size={16} /></>)}
              </button>
            </form>
            <div className="mt-5 text-center text-sm text-gray-500 dark:text-gray-400">
              Didn't get it?{' '}
              <button type="button" onClick={resend} disabled={wait > 0 || busy}
                className="font-medium text-indigo-600 dark:text-indigo-300 hover:underline disabled:no-underline disabled:text-gray-500 dark:disabled:text-gray-400 disabled:cursor-not-allowed" data-testid="fp-resend">
                {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
              </button>
            </div>
          </>
        )}

        <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          <Link to="/login" className="text-indigo-600 dark:text-indigo-300 hover:underline font-medium">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
