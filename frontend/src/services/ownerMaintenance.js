import api from './api'

// The owner's view of GET /maintenance/ includes each record's `service` block.
export const listOwnerRequests = () => api.get('/maintenance/').then((r) => r.data)
export const getMaintenanceSummary = () => api.get('/maintenance/summary').then((r) => r.data)
export const updateOwnerRequestStatus = (id, status) => api.patch(`/maintenance/${id}/status`, { status }).then((r) => r.data)
export const saveServiceDetails = (id, payload) => api.patch(`/maintenance/${id}/service`, payload).then((r) => r.data.request)
