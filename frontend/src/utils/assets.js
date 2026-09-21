import api from '../services/api'

// Property photos are served by the backend (e.g. "/uploads/properties/prop_1.jpg").
export function assetUrl(path) {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path
  return `${api.defaults.baseURL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}
