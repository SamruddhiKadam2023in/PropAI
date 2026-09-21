import api from './api'

// Rental agreements and the early-exit outstanding-rent rule. Every figure (contract total, paid, outstanding) is computed by the
// backend - the browser only displays it, so nothing here can change what a tenant owes.
export const listAgreements = (status) => api.get('/agreements', { params: status && status !== 'all' ? { status } : {} }).then((r) => r.data)
export const recordAgreement = (payload) => api.post('/agreements', payload).then((r) => r.data)
export const endAgreement = (id, payload) => api.post(`/agreements/${id}/end`, payload).then((r) => r.data)
