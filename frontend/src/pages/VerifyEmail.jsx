import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Building2, ChevronRight, Loader2, MailCheck } from 'lucide-react'
import { homeFor, useAuth } from '../contexts/AuthContext'
import { errorMessage } from '../utils/http'

const CODE_LENGTH = 6

/** Second step of sign-up: the person types the one-time code that was emailed to them. Only then does a session start. */
export default function VerifyEmail() {
  const { user, verifyEmail, resendOtp } = useAuth()
  const navigate = useNavigate()
  const { state } = useLocation()

  const [email, setEmail] = useState(state?.email || '')
  const [code, setCode] = useState('')
  const notSent = state?.emailSent === false            // the server could not deliver the email (e.g. mail settings missing)
  const [error, setError] = useState(notSent ? "We couldn't email your code. The server's email settings may be missing or wrong. Press 'Resend code' when it's ready, or contact support." : state?.notice || null)
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const [wait, setWait] = useState(state?.resendIn ?? 60)
  const codeRef = useRef(null)
  const hasEmail = !!state?.email

  useEffect(() => { codeRef.current?.focus() }, [])
  useEffect(() => {                                   // resend countdown
    if (wait <= 0) return undefined
    const id = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(id)
  }, [wait])

  if (user) return <Navigate to={homeFor(user.role)} replace />

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!/^\d+$/.test(code) || code.length !== CODE_LENGTH) { setError(`Enter the ${CODE_LENGTH}-digit code from your email.`); return }
    if (!email.trim()) { setError('Enter the email address you signed up with.'); return }
    setBusy(true)
    try {
      const u = await verifyEmail(email.trim(), code)
      toast.success(`Email verified. Welcome, ${u.full_name}!`)
      navigate(homeFor(u.role), { replace: true })
    } catch (err) {
      setError(errorMessage(err, "We couldn't verify that code."))
      setCode('')
      codeRef.current?.focus()
    } finally { setBusy(false) }
  }

  const resend = async () => {
    if (!email.trim()) { setError('Enter your email address first.'); return }
    setError(null)
    setResending(true)
    try {
      const r = await resendOtp(email.trim())
      setWait(r.resend_in ?? 60)
      toast.success('If that account is waiting to be verified, a new code is on its way.')
    } catch (err) {
      const retry = Number(err?.response?.headers?.['retry-after'])
      if (err?.response?.status === 429 && retry > 0) setWait(retry)
      setError(errorMessage(err, "We couldn't send a new code."))
    } finally { setResending(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-white dark:bg-gray-900">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center"><Building2 size={18} className="text-white" /></div>
          <span className="font-bold text-gray-900 dark:text-white">PropAI</span>
        </div>

        <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-4"><MailCheck size={22} className="text-indigo-600 dark:text-indigo-300" aria-hidden="true" /></div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Verify your email</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-6" data-testid="verify-intro">
          {hasEmail ? (notSent
            ? <>Your account is created, but the code for <span className="font-semibold text-gray-800 dark:text-gray-200">{email}</span> could not be sent.</>
            : <>We sent a {CODE_LENGTH}-digit code to <span className="font-semibold text-gray-800 dark:text-gray-200">{email}</span>. It expires in 10 minutes.</>)
            : 'Enter the email you signed up with and the code we sent you.'}
        </p>

        <form onSubmit={submit} noValidate className="space-y-4">
          {!hasEmail && (
            <div>
              <label className="label" htmlFor="ve-email">Email Address</label>
              <input id="ve-email" className="input-white" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
          )}
          <div>
            <label className="label" htmlFor="ve-code">Verification code</label>
            <input id="ve-code" ref={codeRef} className="input-white text-center text-2xl tracking-[0.5em] font-mono" inputMode="numeric" autoComplete="one-time-code"
              maxLength={CODE_LENGTH} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••••" aria-invalid={!!error} aria-describedby="ve-error" data-testid="otp-input" />
          </div>
          <div id="ve-error" aria-live="polite">
            {error && <p className="p-3 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200 text-sm" role="alert" data-testid="otp-error">{error}</p>}
          </div>
          <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2" disabled={busy} data-testid="verify-submit">
            {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Verifying…</> : (<>Verify and continue <ChevronRight size={16} /></>)}
          </button>
        </form>

        <div className="mt-5 text-center text-sm text-gray-500 dark:text-gray-400">
          Didn't get it?{' '}
          <button type="button" onClick={resend} disabled={wait > 0 || resending}
            className="font-medium text-indigo-600 dark:text-indigo-300 hover:underline disabled:no-underline disabled:text-gray-500 dark:disabled:text-gray-400 disabled:cursor-not-allowed" data-testid="resend">
            {resending ? 'Sending…' : wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
          </button>
        </div>
        <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          <Link to="/register" className="text-indigo-600 dark:text-indigo-300 hover:underline font-medium">Use a different email</Link>
          {' · '}
          <Link to="/login" className="text-indigo-600 dark:text-indigo-300 hover:underline font-medium">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
