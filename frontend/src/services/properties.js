import api from './api'

// For a tenant the backend returns only the property/properties they rent.
export const listMyProperties = () => api.get('/properties/').then((r) => r.data)
export const getDashboardAnalytics = (propertyId) => api.get(`/analytics/dashboard/${propertyId}`).then((r) => r.data)
