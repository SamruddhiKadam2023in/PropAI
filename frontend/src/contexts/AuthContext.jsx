import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api, { clearSession, storeSession } from '../services/api'

const AuthContext = createContext(null)

export const homeFor = (role) => (role === 'tenant' ? '/tenant' : role === 'owner' ? '/owner' : '/manager')

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadUser = useCallback(async () => {
    const token = localStorage.getItem('token')
    if (!token && !localStorage.getItem('refresh_token')) { setLoading(false); return }
    try {
      // If the short-lived access token has expired, the api client silently exchanges the refresh token and retries this call.
      const { data } = await api.get('/auth/me')
      setUser(data)
    } catch {
      clearSession()
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadUser() }, [loadUser])

  const startSession = (data) => {
    storeSession(data)
    setUser(data.user)
    return data.user
  }

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password })
    return startSession(data)
  }

  // Public sign-up creates an UNVERIFIED account and emails a code; no session starts until verifyEmail succeeds.
  const register = async (payload) => {
    const { data } = await api.post('/auth/register', payload)
    return data
  }

  const verifyEmail = async (email, otp) => {
    const { data } = await api.post('/auth/verify-email', { email, otp })
    return startSession(data)
  }

  // The signed-in person edited their profile: keep the shared user object (sidebar, greetings) in step.
  const updateUser = (data) => setUser((u) => ({ ...u, ...data }))

  // Changing the password signs the OTHER devices out; the server hands this device a fresh session.
  const changePassword = async (current_password, new_password) => {
    const { data } = await api.post('/auth/change-password', { current_password, new_password })
    return startSession(data)
  }

  const resendOtp = async (email) => {
    const { data } = await api.post('/auth/resend-otp', { email })
    return data
  }

  const logout = () => {
    const refresh_token = localStorage.getItem('refresh_token')
    if (refresh_token) api.post('/auth/logout', { refresh_token }).catch(() => {})   // revoke it server-side; never block signing out
    clearSession()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, verifyEmail, resendOtp, updateUser, changePassword, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
