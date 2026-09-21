import axios from 'axios'

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL,
  timeout: 30000,
})

// Attach stored token on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Calls where a 401 means "wrong credentials / bad code" and must reach the form that made them - never trigger a refresh or a redirect.
const AUTH_CALLS = ['/auth/login', '/auth/register', '/auth/verify-email', '/auth/resend-otp', '/auth/refresh', '/auth/logout']
const isAuthCall = (config) => AUTH_CALLS.some((p) => (config?.url || '').startsWith(p))

export function storeSession({ access_token, refresh_token }) {
  localStorage.setItem('token', access_token)
  if (refresh_token) localStorage.setItem('refresh_token', refresh_token)
}

export function clearSession() {
  localStorage.removeItem('token')
  localStorage.removeItem('refresh_token')
  delete api.defaults.headers.common['Authorization']
}

// One refresh at a time: requests that fail together share it instead of each spending (and invalidating) the same refresh token.
let refreshing = null
function refreshSession() {
  const refresh_token = localStorage.getItem('refresh_token')
  if (!refresh_token) return Promise.reject(new Error('no refresh token'))
  return axios.post(`${baseURL}/auth/refresh`, { refresh_token }, { timeout: 15000 }).then(({ data }) => {
    storeSession(data)
    return data.access_token
  })
}

function endSession() {
  clearSession()
  if (window.location.pathname !== '/login') window.location.href = '/login'
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const config = err.config
    if (err.response?.status !== 401 || !config || isAuthCall(config)) return Promise.reject(err)
    if (config._retried) { endSession(); return Promise.reject(err) }
    config._retried = true
    try {
      refreshing = refreshing || refreshSession().finally(() => { refreshing = null })
      const token = await refreshing
      config.headers.Authorization = `Bearer ${token}`
      return api(config)                     // the access token had simply expired: replay the request once with the new one
    } catch {
      endSession()
      return Promise.reject(err)
    }
  },
)

export default api
