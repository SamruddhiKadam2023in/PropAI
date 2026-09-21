import api from './api'

// Tenant payments. Everything here is served from the backend database - a tenant only ever receives their own transactions.
export const getPaymentSummary = () => api.get('/financial/payments/summary').then((r) => r.data)
export const listTransactions = () => api.get('/financial/payments').then((r) => r.data)
export const recordPayment = (payload) => api.post('/financial/payments', payload).then((r) => r.data)
export const downloadReceipt = (id) => api.get(`/reports/receipt/${id}/pdf`, { responseType: 'blob' })
