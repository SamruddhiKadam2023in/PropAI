import api from './api'

export const listMaintenanceRequests = () => api.get('/maintenance/').then((r) => r.data)
export const createMaintenanceRequest = (payload) => api.post('/maintenance/', payload).then((r) => r.data)
