import api from './api'

export const listNotifications = ({ limit = 50, skip = 0, unreadOnly = false } = {}) =>
  api.get('/notifications/', { params: { limit, skip, unread_only: unreadOnly || undefined } }).then((r) => r.data)
export const getUnreadCount = () => api.get('/notifications/unread-count').then((r) => r.data.count)
export const markNotificationRead = (id) => api.patch(`/notifications/${id}/read`)
export const markAllNotificationsRead = () => api.patch('/notifications/read-all')
