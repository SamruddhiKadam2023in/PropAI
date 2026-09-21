import api from './api'

// Repair contacts (Owner / Manager only). Everything shown comes from the backend database.
export const listProviders = (params = {}) => api.get('/service-providers/', { params }).then((r) => r.data.providers)
export const createProvider = (payload) => api.post('/service-providers/', payload).then((r) => r.data)
export const updateProvider = (id, payload) => api.put(`/service-providers/${id}`, payload).then((r) => r.data)
export const deleteProvider = (id) => api.delete(`/service-providers/${id}`)
// Maintenance request -> recommended service category -> providers to contact.
export const providersForRequest = (requestId) => api.get(`/service-providers/for-request/${requestId}`).then((r) => r.data)
