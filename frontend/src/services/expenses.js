import api from './api'

export const downloadExpenseTemplate = () => api.get('/financial/expenses/bulk-import-template', { responseType: 'blob' }).then((r) => r.data)

export const importExpenses = (propertyId, file) => {
  const form = new FormData()
  form.append('property_id', propertyId)
  form.append('file', file)
  return api.post('/financial/expenses/bulk-import', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
}
